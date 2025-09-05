// services/contentCleaningService.ts - FIXED VERSION
export class ContentCleaningService {
  /**
   * Clean content for active chat display with web search preservation
   * This is the CRITICAL method for preserving web search citations
   */
  static cleanForActiveChat(content: string, options?: { 
    preserveWebSearch?: boolean,
    preserveFileLinks?: boolean 
  }): string {
    const { preserveWebSearch = false, preserveFileLinks = true } = options || {};
    
    if (typeof content !== 'string') return content;
    
    console.log('=== ACTIVE CHAT CLEANING ===');
    console.log(`Web Search Preservation: ${preserveWebSearch}`);
    console.log('Original length:', content.length);
    
    // Always preserve file links
    if (preserveFileLinks && content.includes('/api/files/')) {
      return this.safeCleanWithPlaceholders(content, preserveWebSearch);
    }
    
    // If web search should be preserved, only remove wrapper contexts
    if (preserveWebSearch) {
      let cleaned = content;
      
      // ONLY remove the internal context wrappers, NOT the citations
      cleaned = cleaned.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
      cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
      
      // DO NOT remove Source: lines when preserving web search
      // DO NOT remove URLs with ↗ symbols
      // DO NOT remove [PDF] indicators
      // DO NOT call removeInstructions or removeSearchArtifacts
      
      // Only normalize formatting gently
      cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n'); // Less aggressive newline normalization
      cleaned = cleaned.trim();
      
      return cleaned;
    }
    
    // Regular cleaning when NOT preserving web search
    let cleaned = this.removeSearchArtifacts(content);
    cleaned = this.removeInstructions(cleaned);
    cleaned = this.normalizeFormatting(cleaned);
    
    return cleaned;
  }

  /**
   * Clean content while preserving file links - Enhanced for web search
   */
  static safeCleanWithPlaceholders(text: string, preserveWebSearch: boolean = false): string {
    if (typeof text !== 'string') return text;
    
    // Step 1: Store file links with placeholders
    const fileLinkRegex = /\[Download .*?\]\(\/api\/files\/[^)]+\)/g;
    const plainFileRegex = /\/api\/files\/[a-zA-Z0-9-_]+/g;
    const quotedFileRegex = /"\/api\/files\/[a-zA-Z0-9-_]+"/g;
    
    const fileLinksMap = new Map<string, string>();
    let placeholderIndex = 0;
    let safeText = text;
    
    // Replace file links with placeholders
    safeText = safeText.replace(fileLinkRegex, (match) => {
      const placeholder = `__FILE_PLACEHOLDER_${placeholderIndex++}__`;
      fileLinksMap.set(placeholder, match);
      return placeholder;
    });
    
    safeText = safeText.replace(plainFileRegex, (match) => {
      const placeholder = `__FILE_PLACEHOLDER_${placeholderIndex++}__`;
      fileLinksMap.set(placeholder, match);
      return placeholder;
    });
    
    safeText = safeText.replace(quotedFileRegex, (match) => {
      const placeholder = `__FILE_PLACEHOLDER_${placeholderIndex++}__`;
      fileLinksMap.set(placeholder, match);
      return placeholder;
    });
    
    // Step 2: Clean based on preservation settings
    if (preserveWebSearch) {
      // Only remove wrapper contexts, preserve citations
      safeText = safeText.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
      safeText = safeText.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
      safeText = safeText.replace(/\n{4,}/g, '\n\n\n');
    } else {
      // Regular aggressive cleaning
      safeText = this.removeSearchArtifacts(safeText);
      safeText = this.removeInstructions(safeText);
      safeText = this.normalizeFormatting(safeText);
    }
    
    // Step 3: Restore file links
    fileLinksMap.forEach((original, placeholder) => {
      safeText = safeText.replace(placeholder, original);
    });
    
    return safeText.trim();
  }

  /**
   * Remove web search artifacts - V1 COMPATIBLE VERSION
   */
  static removeSearchArtifacts(content: string): string {
    let cleaned = content;
    
    // Remove internal context wrappers
    cleaned = cleaned.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
    cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
    
    // Remove web summaries
    cleaned = cleaned.replace(/Web Summary:\s*[^\n]*\n/gi, '');
    cleaned = cleaned.replace(/Current Web Information:\s*\n[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '');
    
    // Remove numbered source entries
    cleaned = cleaned.replace(/\d+\.\s+[^.]+\.\.\.\s*Source:\s*https?:\/\/[^\s]+\s*/gi, '');
    
    // Remove search instructions
    cleaned = cleaned.replace(/IMPORTANT: Please provide a natural response incorporating relevant information[^\n]*\n?/gi, '');
    
    // Remove other patterns
    cleaned = cleaned.replace(/\【\d+†source\】/g, '');
    cleaned = cleaned.replace(/Search performed on:\s*[^\n]*\n/gi, '');
    
    return cleaned;
  }

  /**
   * Remove instructions and metadata
   */
  static removeInstructions(content: string): string {
    let cleaned = content;
    
    // Remove instruction lines
    cleaned = cleaned.replace(/Instructions: Please incorporate[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/IMPORTANT:\s*Please provide[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
    cleaned = cleaned.replace(/Note:\s*\d+\s*files? from previous messages[^\n]*\n?/gi, '');
    
    // Remove web search instructions
    cleaned = cleaned.replace(/You have access to current web search results[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/You also have access to current web search results[^\n]*\n?/gi, '');
    
    // Remove JSON formatting instructions
    cleaned = cleaned.replace(/Please format your response as a valid JSON[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/DO NOT include any text outside[^\n]*\n?/gi, '');
    
    return cleaned;
  }

  /**
   * Normalize overall formatting
   */
  static normalizeFormatting(text: string): string {
    let normalized = text;
    
    // Remove divider lines
    normalized = normalized.replace(/^\s*---\s*$/gm, '');
    normalized = normalized.replace(/^\s*===\s*$/gm, '');
    normalized = normalized.replace(/^\s*\*\*\*\s*$/gm, '');
    
    // Clean up empty bullet points
    normalized = normalized.replace(/^\s*•\s*$/gm, '');
    normalized = normalized.replace(/^\s*\*\s*$/gm, '');
    normalized = normalized.replace(/^\s*-\s*$/gm, '');
    
    // Fix excessive newlines
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    
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