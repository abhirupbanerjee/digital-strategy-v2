// services/contentCleaningService.ts
export class ContentCleaningService {
  /**
   * Clean content while preserving file links
   * Extracted from: /app/api/cleanup-threads/route.ts
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
   * Remove web search artifacts
   * Extracted from: /app/api/threads/route.ts
   */
  static removeSearchArtifacts(content: string): string {
    let cleaned = content;
    
    // Remove search context blocks
    cleaned = cleaned.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
    cleaned = cleaned.replace(/\[Current Web Information[^\]]*\]:\s*/gi, '');
    
    // Remove web summaries and results
    cleaned = cleaned.replace(/Web Summary:\s*[^\n]*\n/gi, '');
    cleaned = cleaned.replace(/Top Search Results:\s*\n[\s\S]*?Instructions:[^\n]*\n/gi, '');
    
    // Remove source citations (various formats)
    cleaned = cleaned.replace(/\【\d+:\d+†source\】/g, '');
    cleaned = cleaned.replace(/\【\d+†source\】/g, '');
    cleaned = cleaned.replace(/\[\d+:\d+†source\]/g, '');
    cleaned = cleaned.replace(/\[\d+†source\]/g, '');
    
    // Remove PDF/document references with sources
    cleaned = cleaned.replace(/\d+\.\s+\[PDF\]\s+[^\n]*\n\s*[^\n]*\.\.\.\s*Source:\s*https?:\/\/[^\s]+\s*/gi, '');
    cleaned = cleaned.replace(/\d+\.\s+[^.]+\.\.\.\s*Source:\s*https?:\/\/[^\s]+\s*/gi, '');
    
    // Remove search metadata
    cleaned = cleaned.replace(/Search performed on:\s*[^\n]*\n/gi, '');
    cleaned = cleaned.replace(/Query:\s*"[^"]*"\s*/gi, '');
    
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
    
    // Remove JSON formatting instructions
    cleaned = cleaned.replace(/Please format your response as a valid JSON[^\n]*\n?/gi, '');
    cleaned = cleaned.replace(/DO NOT include any text outside[^\n]*\n?/gi, '');
    
    return cleaned;
  }

  /**
   * Normalize whitespace and formatting
   */
  static normalizeWhitespace(text: string): string {
    return text
      .replace(/\s+/g, ' ')           // Multiple spaces to single space
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple newlines to double newline
      .trim();
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
    
    // Fix excessive newlines
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    
    // Trim each line
    normalized = normalized.split('\n').map(line => line.trim()).join('\n');
    
    return normalized.trim();
  }

  /**
   * Clean message content for display
   * Main entry point for cleaning
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
    cleaned = this.normalizeWhitespace(cleaned);
    
    return cleaned;
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
   * Check if content has search artifacts
   */
  static hasSearchArtifacts(content: string): boolean {
    const patterns = [
      /\[INTERNAL SEARCH CONTEXT/i,
      /\[Current Web Information/i,
      /Web Summary:/i,
      /Top Search Results:/i,
      /\【\d+†source\】/,
      /Source:\s*https?:\/\//i
    ];
    
    return patterns.some(pattern => pattern.test(content));
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