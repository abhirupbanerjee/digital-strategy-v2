// services/contentCleaningService.ts - Complete content cleaning service with sandbox URL support
export class ContentCleaningService {
  /**
   * Clean content for active chat display
   * CRITICAL: Must handle OpenAI sandbox URLs and preserve file links
   */
  static cleanForActiveChat(content: string, options?: { 
    preserveWebSearch?: boolean,
    preserveFileLinks?: boolean 
  }): string {
    const { preserveWebSearch = false, preserveFileLinks = true } = options || {};
    
    if (typeof content !== 'string') return content;
    
    console.log('=== CONTENT CLEANING START ===');
    const hasLinks = this.detectFileLinks(content);
    console.log('Original content has file links:', hasLinks);
    
    // ALWAYS preserve file links by default
    if (preserveFileLinks) {
      return this.cleanWithFilePreservation(content, preserveWebSearch);
    }
    
    // Fallback to regular cleaning (should rarely happen)
    return this.regularClean(content, preserveWebSearch);
  }

  /**
   * Detect if content has any file links
   */
  static detectFileLinks(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    
    return content.includes('/api/files/') || 
           content.includes('sandbox:/') || 
           content.includes('sandbox://') ||
           content.includes('blob.vercel-storage.com') ||
           content.includes('vercel-storage.com');
  }

  /**
   * Clean content while ABSOLUTELY preserving file links
   */
  static cleanWithFilePreservation(text: string, preserveWebSearch: boolean = false): string {
    if (typeof text !== 'string') return text;
    
    // Step 1: Identify and protect ALL file link patterns
    const fileLinksMap = new Map<string, string>();
    let placeholderIndex = 0;
    let protectedText = text;
    
    // Comprehensive file link patterns INCLUDING OpenAI sandbox URLs
    const filePatterns = [
      // OpenAI sandbox URLs - CRITICAL PATTERNS
      /sandbox:\/\/mnt\/data\/[^\s\)]+/g,
      /sandbox:\/\/[^\s\)]+/g, // Any sandbox URL
      // Markdown links with sandbox URLs
      /\[([^\]]+)\]\(sandbox:\/\/[^)]+\)/g,
      // Markdown links with /api/files/
      /\[([^\]]+)\]\(\/api\/files\/[^)]+\)/g,
      // Plain /api/files/ URLs
      /\/api\/files\/[a-zA-Z0-9-_]+/g,
      // Quoted file URLs
      /"\/api\/files\/[^"]+"/g,
      /`\/api\/files\/[^`]+`/g,
      // HTML attributes with file URLs
      /href="\/api\/files\/[^"]+"/g,
      /src="\/api\/files\/[^"]+"/g,
      // Vercel blob URLs (multiple patterns)
      /https:\/\/[a-zA-Z0-9-]+\.public\.blob\.vercel-storage\.com\/[^)\s]+/g,
      /https:\/\/[^\/]+\.vercel-storage\.com\/[^)\s]+/g,
      // Markdown links with blob URLs
      /\[([^\]]+)\]\(https:\/\/[^\/]+\.vercel-storage\.com\/[^)]+\)/g
    ];
    
    // Replace ALL file patterns with placeholders
    filePatterns.forEach((pattern, idx) => {
      protectedText = protectedText.replace(pattern, (match) => {
        const placeholder = `__FILE_LINK_${placeholderIndex++}__`;
        fileLinksMap.set(placeholder, match);
        console.log(`Protected file link pattern ${idx}: ${match.substring(0, 80)}...`);
        return placeholder;
      });
    });
    
    // Step 2: Remove ONLY the specific search instruction text
    protectedText = protectedText.replace(
      /IMPORTANT:\s*Please provide a natural response[^.]*\./gi, 
      ''
    );
    
    // Remove variations of the instruction
    protectedText = protectedText.replace(/Cite sources naturally[^.]*but do not mention[^.]*\./gi, '');
    protectedText = protectedText.replace(/Focus on being helpful and accurate\./gi, '');
    
    // Remove search context wrappers
    protectedText = protectedText.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
    
    // Remove other instruction patterns but be careful
    protectedText = protectedText.replace(/Instructions: Please incorporate[^\n]*\n?/gi, '');
    protectedText = protectedText.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
    protectedText = protectedText.replace(/You have access to current web search results[^\n]*\n?/gi, '');
    protectedText = protectedText.replace(/Please format your response as a valid JSON[^\n]*\n?/gi, '');
    protectedText = protectedText.replace(/DO NOT include any text outside[^\n]*\n?/gi, '');
    
    // Remove web search artifacts if not preserving
    if (!preserveWebSearch) {
      protectedText = protectedText.replace(/Web Summary:\s*[^\n]*\n/gi, '');
      protectedText = protectedText.replace(/Current Web Information:\s*\n[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
      protectedText = protectedText.replace(/Top Search Results:\s*\n[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
      protectedText = protectedText.replace(/\【\d+†source\】/g, '');
      protectedText = protectedText.replace(/Search performed on:\s*[^\n]*\n/gi, '');
    }
    
    // Step 3: Clean up formatting gently
    protectedText = protectedText.replace(/\n{5,}/g, '\n\n\n');
    protectedText = protectedText.replace(/^\n{3,}/, '\n');
    protectedText = protectedText.replace(/\n{3,}$/, '\n');
    
    // Step 4: RESTORE ALL FILE LINKS
    fileLinksMap.forEach((original, placeholder) => {
      protectedText = protectedText.replace(placeholder, original);
    });
    
    console.log('=== CONTENT CLEANING END ===');
    // FIXED: Check for all types of file links including sandbox:/
    const finalHasLinks = this.detectFileLinks(protectedText);
    console.log('Final content has file links:', finalHasLinks);
    console.log(`Preserved ${fileLinksMap.size} file links`);
    
    // Debug: Show samples of preserved links
    if (fileLinksMap.size > 0) {
      const samples = Array.from(fileLinksMap.values()).slice(0, 3);
      samples.forEach((link, i) => {
        console.log(`Sample preserved link ${i + 1}:`, link.substring(0, 100));
      });
    }
    
    return protectedText.trim();
  }

  /**
   * Convert sandbox URLs to downloadable URLs
   * This should be called after content is loaded from OpenAI
   */
  static convertSandboxUrls(content: string, fileMapping?: Map<string, string>): string {
    if (!content || typeof content !== 'string') return content;
    if (!fileMapping || fileMapping.size === 0) return content;
    
    console.log(`Converting sandbox URLs with ${fileMapping.size} mappings`);
    
    // Pattern for sandbox URLs
    const sandboxPattern = /sandbox:\/\/mnt\/data\/([^\s\)]+)/g;
    let replacementCount = 0;
    
    const convertedContent = content.replace(sandboxPattern, (match, filename) => {
      // Try exact match first
      if (fileMapping.has(match)) {
        replacementCount++;
        return fileMapping.get(match)!;
      }
      
      // Try filename only
      if (fileMapping.has(filename)) {
        replacementCount++;
        return fileMapping.get(filename)!;
      }
      
      // Try to find partial match
      const partialMatch = Array.from(fileMapping.keys()).find(key => {
        if (typeof key !== 'string') return false;
        return filename.includes(key) || key.includes(filename);
      });
      
      if (partialMatch) {
        replacementCount++;
        return fileMapping.get(partialMatch)!;
      }
      
      console.warn(`No mapping found for sandbox URL: ${match}`);
      return match;
    });
    
    console.log(`Converted ${replacementCount} sandbox URLs`);
    return convertedContent;
  }

  /**
   * Safe clean with placeholders - alias for consistency
   */
  static safeCleanWithPlaceholders(text: string, preserveWebSearch: boolean = false): string {
    return this.cleanWithFilePreservation(text, preserveWebSearch);
  }

  /**
   * Clean for display - ALWAYS preserve file links
   */
  static cleanForDisplay(content: string): string {
    return this.cleanWithFilePreservation(content, false);
  }

  /**
   * Clean for export
   */
  static cleanForExport(content: string): string {
    // Use file-safe cleaning
    let cleaned = this.cleanWithFilePreservation(content, false);
    
    // Additional export cleaning
    cleaned = cleaned.replace(/^#+\s*$/gm, ''); // Empty headers
    cleaned = cleaned.replace(/^\*\s*$/gm, ''); // Empty bullets
    cleaned = cleaned.replace(/^-\s*$/gm, ''); // Empty dashes
    
    return cleaned.trim();
  }

  // Helper methods
  static regularClean(content: string, preserveWebSearch: boolean): string {
    let cleaned = content;
    
    // Remove search instructions
    cleaned = cleaned.replace(/IMPORTANT: Please provide a natural response[^.]*\./gi, '');
    cleaned = cleaned.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
    
    if (!preserveWebSearch) {
      cleaned = this.removeSearchArtifacts(cleaned);
    }
    
    cleaned = this.normalizeFormatting(cleaned);
    return cleaned;
  }

  static removeSearchArtifacts(content: string): string {
    let cleaned = content;
    
    // Only remove search-specific content, not file links
    cleaned = cleaned.replace(/Web Summary:\s*[^\n]*\n/gi, '');
    cleaned = cleaned.replace(/Current Web Information:\s*\n[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
    cleaned = cleaned.replace(/Top Search Results:\s*\n[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
    
    // Be careful with source entries - don't remove if they contain file links
    const sourcePattern = /\d+\.\s+[^.]+\.\.\.\s*Source:\s*https?:\/\/[^\s]+\s*/gi;
    cleaned = cleaned.replace(sourcePattern, (match) => {
      // Keep if it contains any file link
      if (this.detectFileLinks(match)) {
        return match;
      }
      return '';
    });
    
    cleaned = cleaned.replace(/\【\d+†source\】/g, '');
    cleaned = cleaned.replace(/Search performed on:\s*[^\n]*\n/gi, '');
    
    return cleaned;
  }

  static removeInstructions(content: string): string {
    // Use the file-safe cleaning
    return this.cleanWithFilePreservation(content, false);
  }

  static normalizeFormatting(text: string): string {
    let normalized = text;
    
    // Remove divider lines
    normalized = normalized.replace(/^\s*---\s*$/gm, '');
    normalized = normalized.replace(/^\s*===\s*$/gm, '');
    normalized = normalized.replace(/^\s*\*\*\*\s*$/gm, '');
    
    // Clean up empty bullets
    normalized = normalized.replace(/^\s*•\s*$/gm, '');
    normalized = normalized.replace(/^\s*\*\s*$/gm, '');
    normalized = normalized.replace(/^\s*-\s*$/gm, '');
    
    // Fix excessive newlines but be gentle
    normalized = normalized.replace(/\n{5,}/g, '\n\n\n');
    
    // Trim lines
    normalized = normalized.split('\n')
      .map(line => line.trim())
      .join('\n');
    
    return normalized.trim();
  }

  static hasSearchArtifacts(content: string): boolean {
    const patterns = [
      /\[INTERNAL SEARCH CONTEXT/i,
      /IMPORTANT: Please provide a natural response/i,
      /Cite sources naturally/i,
      /Focus on being helpful and accurate/i,
      /Web Summary:/i,
      /Current Web Information:/i
    ];
    
    return patterns.some(pattern => pattern.test(content));
  }

  static extractTextContent(content: any): string {
    if (typeof content === 'string') {
      return this.cleanForDisplay(content);
    }
    
    if (Array.isArray(content)) {
      return content
        .map(item => {
          if (typeof item === 'string') return item;
          if (item.type === 'text' && item.text) {
            if (typeof item.text === 'string') return item.text;
            if (item.text.value) return item.text.value;
          }
          if (item.text && typeof item.text === 'string') return item.text;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    
    if (content && typeof content === 'object') {
      if (content.text) return String(content.text);
      if (content.content) return String(content.content);
      if (content.message) return String(content.message);
      if (content.value) return String(content.value);
    }
    
    return String(content || '');
  }
}