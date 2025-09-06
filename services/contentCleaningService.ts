// services/contentCleaningService.ts - COMPLETE UPDATED VERSION
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
    
    // ALWAYS check for file links in the actual content being cleaned
    const hasLinks = this.detectFileLinks(content);
    console.log('Original content has file links:', hasLinks);
    
    // If content has file links or we should preserve them, use preservation method
    if (hasLinks || preserveFileLinks) {
      return this.cleanWithFilePreservation(content, preserveWebSearch);
    }
    
    // Fallback to regular cleaning (should rarely happen)
    return this.regularClean(content, preserveWebSearch);
  }

  /**
   * Detect if content has any file links - COMPREHENSIVE VERSION
   */
  static detectFileLinks(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    
    // Comprehensive detection patterns for ALL file types
    const patterns = [
      // API file endpoints
      /\/api\/files\//i,
      
      // Sandbox URLs (all variations)
      /sandbox:\/\//i,
      /sandbox:\/\/mnt\/data\//i,
      
      // Vercel blob storage
      /blob\.vercel-storage\.com/i,
      /vercel-storage\.com/i,
      /public\.blob/i,
      
      // Markdown download/image links
      /\[Download[^\]]*\]\([^)]+\)/i,
      /\!\[[^\]]*\]\([^)]+\)/i,  // Image markdown
      
      // OpenAI file IDs
      /file-[a-zA-Z0-9]{20,}/i,
      
      // Common file extensions in URLs
      /\.(docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|svg|csv|txt|json|xml|zip)\b/i
    ];
    
    const hasLinks = patterns.some(pattern => pattern.test(content));
    
    if (hasLinks) {
      console.log('Detected file link patterns in content');
      // Log which pattern matched for debugging
      patterns.forEach((pattern, idx) => {
        if (pattern.test(content)) {
          console.log(`  Pattern ${idx} matched: ${pattern.source}`);
        }
      });
    }
    
    return hasLinks;
  }

  /**
   * Clean content while ABSOLUTELY preserving file links - ENHANCED VERSION
   */
  static cleanWithFilePreservation(text: string, preserveWebSearch: boolean = false): string {
    if (typeof text !== 'string') return text;
    
    // Step 1: Identify and protect ALL file link patterns
    const fileLinksMap = new Map<string, string>();
    let placeholderIndex = 0;
    let protectedText = text;
    
    // Comprehensive file link patterns INCLUDING all variations
    const filePatterns = [
      // API file URLs
      /\/api\/files\/[a-zA-Z0-9-_]+/g,
      
      // OpenAI sandbox URLs (all variations)
      /sandbox:\/\/mnt\/data\/[^\s\)\]"']+/g,
      /sandbox:\/\/[^\s\)\]"']+/g,
      
      // Markdown links with file URLs
      /\[([^\]]+)\]\((\/api\/files\/[^)]+)\)/g,
      /\[([^\]]+)\]\((sandbox:\/\/[^)]+)\)/g,
      /\[Download[^\]]*\]\([^)]+\)/g,
      
      // Image markdown (CRITICAL for graphs)
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      
      // Vercel blob URLs
      /https:\/\/[a-zA-Z0-9-]+\.public\.blob\.vercel-storage\.com\/[^)\s"']+/g,
      /https:\/\/[^\/]+\.vercel-storage\.com\/[^)\s"']+/g,
      
      // OpenAI File IDs (standalone)
      /\bfile-[a-zA-Z0-9]{20,}\b/g,
      
      // Direct file URLs with extensions
      /https?:\/\/[^\s]+\.(docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|svg|csv|txt|json|xml|zip)(?:\?[^\s]*)?/gi
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
    
    console.log(`Total protected file links: ${fileLinksMap.size}`);
    
    // Step 2: Clean content based on settings
    if (preserveWebSearch) {
      // When preserving web search, only remove wrapper contexts
      protectedText = this.removeMinimalSearchArtifacts(protectedText);
    } else {
      // Remove all search artifacts when not preserving
      protectedText = this.removeAllSearchArtifacts(protectedText);
    }
    
    // Step 3: Remove other unwanted content
    protectedText = this.removeInstructionText(protectedText);
    
    // Step 4: Clean up formatting gently
    protectedText = this.normalizeFormatting(protectedText);
    
    // Step 5: RESTORE ALL FILE LINKS
    fileLinksMap.forEach((original, placeholder) => {
      protectedText = protectedText.replace(placeholder, original);
    });
    
    console.log('=== CONTENT CLEANING END ===');
    const finalHasLinks = this.detectFileLinks(protectedText);
    console.log('Final content has file links:', finalHasLinks);
    console.log(`Preserved ${fileLinksMap.size} file links`);
    
    if (fileLinksMap.size > 0 && fileLinksMap.size <= 3) {
      // Log samples for small number of links
      Array.from(fileLinksMap.values()).forEach((link, i) => {
        console.log(`Preserved link ${i + 1}: ${link.substring(0, 100)}`);
      });
    }
    
    return protectedText.trim();
  }

  /**
   * Remove minimal search artifacts (preserving web search results)
   */
  private static removeMinimalSearchArtifacts(text: string): string {
    let cleaned = text;
    
    // Only remove instruction wrappers, not the actual search results
    cleaned = cleaned.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:/gi, '');
    cleaned = cleaned.replace(/\[END SEARCH CONTEXT\]/gi, '');
    cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
    cleaned = cleaned.replace(/IMPORTANT:\s*Please provide a natural response[^.]*\./gi, '');
    cleaned = cleaned.replace(/Instructions: Please incorporate[^\n]*\n?/gi, '');
    
    return cleaned;
  }

  /**
   * Remove all search artifacts (when not preserving web search)
   */
  private static removeAllSearchArtifacts(text: string): string {
    let cleaned = text;
    
    // Remove all search-related content
    cleaned = cleaned.replace(/IMPORTANT:\s*Please provide a natural response[^.]*\./gi, '');
    cleaned = cleaned.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
    cleaned = cleaned.replace(/Instructions: Please incorporate[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
    cleaned = cleaned.replace(/You have access to current web search results[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/Please format your response as a valid JSON[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/Please provide a natural response incorporating[^\n]*\n?/gi, '');
    
    // Remove search result sections
    cleaned = cleaned.replace(/Web Summary:\s*[^\n]*\n/gi, '');
    cleaned = cleaned.replace(/Current Web Information:\s*\n[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
    cleaned = cleaned.replace(/Top Search Results:\s*\n[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
    cleaned = cleaned.replace(/\【\d+†source\】/g, '');
    cleaned = cleaned.replace(/Search performed on:\s*[^\n]*\n/gi, '');
    
    // Remove numbered source entries ONLY if they don't contain file links
    const sourcePattern = /\d+\.\s+[^.]+\.\.\.\s*Source:\s*https?:\/\/[^\s]+\s*/gi;
    cleaned = cleaned.replace(sourcePattern, (match) => {
      // Keep if it contains any file link
      if (this.detectFileLinks(match)) {
        return match;
      }
      return '';
    });
    
    return cleaned;
  }

  /**
   * Remove instruction text that shouldn't be visible to users
   */
  private static removeInstructionText(text: string): string {
    let cleaned = text;
    
    // Remove common instruction patterns
    cleaned = cleaned.replace(/Please provide a natural response[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/Cite sources naturally[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/Focus on being helpful and accurate[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/Maintain a conversational tone[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/Be concise but informative[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/Use the information provided[^\n]*\n?/gi, '');
    
    return cleaned;
  }

  /**
   * Convert sandbox URLs to downloadable URLs
   */
  static convertSandboxUrls(content: string, fileMapping?: Map<string, string>): string {
    if (!content || typeof content !== 'string') return content;
    if (!fileMapping || fileMapping.size === 0) return content;
    
    console.log(`Converting sandbox URLs with ${fileMapping.size} mappings`);
    
    // Pattern for sandbox URLs (more comprehensive)
    const sandboxPatterns = [
      /sandbox:\/\/mnt\/data\/([^\s\)\]"']+)/g,
      /sandbox:\/\/([^\s\)\]"']+)/g
    ];
    
    let replacementCount = 0;
    let convertedContent = content;
    
    sandboxPatterns.forEach(pattern => {
      convertedContent = convertedContent.replace(pattern, (match, filename) => {
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
    
    // Additional export-specific cleaning
    cleaned = cleaned.replace(/^#+\s*$/gm, ''); // Empty headers
    cleaned = cleaned.replace(/^\*\s*$/gm, ''); // Empty bullets
    cleaned = cleaned.replace(/^-\s*$/gm, ''); // Empty dashes
    cleaned = cleaned.replace(/^\s*•\s*$/gm, ''); // Empty bullet points
    
    return cleaned.trim();
  }

  /**
   * Regular clean without file preservation (rarely used)
   */
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

  /**
   * Remove search artifacts (legacy method for compatibility)
   */
  static removeSearchArtifacts(content: string): string {
    return this.removeAllSearchArtifacts(content);
  }

  /**
   * Remove instructions (legacy method for compatibility)
   */
  static removeInstructions(content: string): string {
    return this.cleanWithFilePreservation(content, false);
  }

  /**
   * Normalize formatting without being too aggressive
   */
  static normalizeFormatting(text: string): string {
    let normalized = text;
    
    // Remove divider lines
    normalized = normalized.replace(/^\s*---\s*$/gm, '');
    normalized = normalized.replace(/^\s*===\s*$/gm, '');
    normalized = normalized.replace(/^\s*\*\*\*\s*$/gm, '');
    normalized = normalized.replace(/^\s*___\s*$/gm, '');
    
    // Fix excessive newlines but be gentle
    normalized = normalized.replace(/\n{5,}/g, '\n\n\n');
    normalized = normalized.replace(/^\n{3,}/, '\n');
    normalized = normalized.replace(/\n{3,}$/, '\n');
    
    // Don't trim individual lines as it might break markdown formatting
    
    return normalized.trim();
  }

  /**
   * Check if content has search artifacts
   */
  static hasSearchArtifacts(content: string): boolean {
    const patterns = [
      /\[INTERNAL SEARCH CONTEXT/i,
      /IMPORTANT: Please provide a natural response/i,
      /Instructions: Please incorporate/i,
      /Web Summary:/i,
      /Current Web Information:/i,
      /Top Search Results:/i,
      /\[Note: Web search was requested/i,
      /You have access to current web search results/i
    ];
    
    return patterns.some(pattern => pattern.test(content));
  }

  /**
   * Extract text content from various formats
   */
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

  /**
   * Process and inject file outputs (for images/graphs)
   * NEW METHOD for handling fileOutput array
   */
  static injectFileOutputs(
    content: string,
    fileOutputs: Array<{ fileId: string; description: string }>
  ): string {
    if (!fileOutputs || fileOutputs.length === 0) {
      return content;
    }
    
    let enhancedContent = content;
    
    fileOutputs.forEach(file => {
      const fileUrl = `/api/files/${file.fileId}`;
      const description = file.description || 'Generated file';
      
      // Determine if it's likely an image/graph
      const imageKeywords = [
        'graph', 'chart', 'plot', 'diagram', 
        'image', 'visualization', 'figure',
        'drawing', 'illustration', 'picture'
      ];
      
      const isImage = imageKeywords.some(keyword => 
        description.toLowerCase().includes(keyword)
      );
      
      if (isImage) {
        // Add image markdown
        enhancedContent += `\n\n![${description}](${fileUrl})`;
      } else {
        // Add download link
        enhancedContent += `\n\n[Download ${description}](${fileUrl})`;
      }
    });
    
    return enhancedContent;
  }
}