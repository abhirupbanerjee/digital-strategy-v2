// services/contentCleaningService.ts - ENHANCED VERSION
export class ContentCleaningService {
  /**
   * Clean content while preserving file links - ENHANCED for web search
   */
  static safeCleanWithPlaceholders(text: string): string {
    if (typeof text !== 'string') return text;
    
    console.log('=== CONTENT CLEANING START ===');
    console.log('Original text length:', text.length);
    
    // Step 1: Store file links with placeholders
    const fileLinkRegex = /\[Download .*?\]\(\/api\/files\/[^)]+\)/g;
    const plainFileRegex = /\/api\/files\/[a-zA-Z0-9-_]+/g;
    const quotedFileRegex = /"\/api\/files\/[a-zA-Z0-9-_]+"/g;
    
    const fileLinksMap = new Map<string, string>();
    let placeholderIndex = 0;
    let safeText = text;
    
    // Replace markdown file links with placeholders
    safeText = safeText.replace(fileLinkRegex, (match) => {
      const placeholder = `__FILE_PLACEHOLDER_${placeholderIndex++}__`;
      fileLinksMap.set(placeholder, match);
      return placeholder;
    });
    
    // Replace plain file links
    safeText = safeText.replace(plainFileRegex, (match) => {
      const placeholder = `__FILE_PLACEHOLDER_${placeholderIndex++}__`;
      fileLinksMap.set(placeholder, match);
      return placeholder;
    });
    
    // Replace quoted file links
    safeText = safeText.replace(quotedFileRegex, (match) => {
      const placeholder = `__FILE_PLACEHOLDER_${placeholderIndex++}__`;
      fileLinksMap.set(placeholder, match);
      return placeholder;
    });
    
    console.log(`Protected ${fileLinksMap.size} file links with placeholders`);
    
    // Step 2: Clean search artifacts and other unwanted content
    safeText = this.removeSearchArtifacts(safeText);
    safeText = this.removeInstructions(safeText);
    safeText = this.normalizeFormatting(safeText);
    
    // Step 3: Restore file links
    fileLinksMap.forEach((original, placeholder) => {
      safeText = safeText.replace(placeholder, original);
    });
    
    console.log('=== CONTENT CLEANING END ===');
    console.log(`Cleaned text length: ${safeText.length}`);
    console.log(`Removed ${text.length - safeText.length} characters`);
    
    return safeText;
  }

  /**
   * Remove web search artifacts - V1 COMPATIBLE VERSION
   */
  static removeSearchArtifacts(content: string): string {
    let cleaned = content;
    
    // ✅ V1 PATTERNS - Target exact V1 search context format
    cleaned = cleaned.replace(/\[INTERNAL SEARCH CONTEXT - DO NOT INCLUDE IN RESPONSE\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
    cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
    
    // ✅ V1 PATTERNS - Remove web summaries and results as they appeared in V1
    cleaned = cleaned.replace(/Web Summary:\s*[^\n]*\n/gi, '');
    cleaned = cleaned.replace(/Current Web Information:\s*\n[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
    
    // ✅ V1 PATTERNS - Remove numbered source entries (V1 format)
    cleaned = cleaned.replace(/\d+\.\s+[^.]+\.\.\.\s*Source:\s*https?:\/\/[^\s]+\s*/gi, '');
    
    // ✅ V1 PATTERNS - Remove search instructions
    cleaned = cleaned.replace(/IMPORTANT: Please provide a natural response incorporating relevant information[^\n]*\n?/gi, '');
    
    // Keep only essential V2 patterns that don't conflict with V1
    cleaned = cleaned.replace(/\【\d+†source\】/g, '');
    cleaned = cleaned.replace(/Search performed on:\s*[^\n]*\n/gi, '');
    
    return cleaned;
  }

  /**
   * Remove instructions and metadata - ENHANCED
   */
  static removeInstructions(content: string): string {
    let cleaned = content;
    
    // Remove instruction lines
    cleaned = cleaned.replace(/Instructions: Please incorporate[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/IMPORTANT:\s*Please provide[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
    cleaned = cleaned.replace(/Note:\s*\d+\s*files? from previous messages[^\n]*\n?/gi, '');
    
    // 🔥 ENHANCED: Remove web search instructions
    cleaned = cleaned.replace(/You have access to current web search results[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/You also have access to current web search results[^\n]*\n?/gi, '');
    
    // Remove JSON formatting instructions
    cleaned = cleaned.replace(/Please format your response as a valid JSON[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/DO NOT include any text outside[^\n]*\n?/gi, '');
    
    return cleaned;
  }

  /**
   * Normalize overall formatting - ENHANCED
   */
  static normalizeFormatting(text: string): string {
    let normalized = text;
    
    // Remove divider lines
    normalized = normalized.replace(/^\s*---\s*$/gm, '');
    normalized = normalized.replace(/^\s*===\s*$/gm, '');
    normalized = normalized.replace(/^\s*\*\*\*\s*$/gm, '');
    
    // 🔥 ENHANCED: Clean up empty bullet points from web search removal
    normalized = normalized.replace(/^\s*•\s*$/gm, '');
    normalized = normalized.replace(/^\s*\*\s*$/gm, '');
    normalized = normalized.replace(/^\s*-\s*$/gm, '');
    
    // Fix excessive newlines
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    
    // 🔥 ENHANCED: Remove orphaned section headers that might be left after cleaning
    normalized = normalized.replace(/^\s*Middleware Platforms with API Gateway Management\s*$/gm, '');
    
    // Trim each line and remove empty lines at start/end
    normalized = normalized.split('\n')
      .map(line => line.trim())
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
    
    return normalized;
  }

  /**
   * Check if content has search artifacts
   */
  static hasSearchArtifacts(content: string): boolean {
    const patterns = [
      /\[INTERNAL SEARCH CONTEXT/i,
      /\[Current Web Information/i,
      /Web Summary:/i,
      /Top Search Results:/i,
      /\【\d+†source\】/,
      /Source:\s*https?:\/\//i,
      /^\s*•\s+[^•\n]*?Summary:\s*[^\n]*$/m,
      /Based on the current web information/i
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
          if (item.type === 'text' && item.text) return item.text;
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
    }
    
    return String(content || '');
  }

  /**
   * Clean message content for display
   */
  static cleanForDisplay(content: string): string {
    // Skip cleaning if content has file links to preserve them
    if (content.includes('/api/files/')) {
      return this.safeCleanWithPlaceholders(content);
    }
    
    // Otherwise do regular cleaning
    let cleaned = this.removeSearchArtifacts(content);
    cleaned = this.removeInstructions(cleaned);
    cleaned = this.normalizeFormatting(cleaned);
    
    return cleaned;
  }

  /**
   * Clean content for export (more aggressive)
   */
  static cleanForExport(content: string): string {
    let cleaned = this.safeCleanWithPlaceholders(content);
    
    // Additional export-specific cleaning
    cleaned = cleaned.replace(/^#+\s*$/, ''); // Remove empty headers
    cleaned = cleaned.replace(/^\*\s*$/, '');  // Remove empty list items
    
    return cleaned;
  }
}