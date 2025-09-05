// utils/contentUtils.ts - Complete content utility functions
export const extractTextContent = (content: any): string => {
  if (typeof content === 'string') {
    let cleaned = content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&lt;br\s*\/?&gt;/gi, '\n')
      .replace(/\s*<br>\s*/gi, '\n')
      .replace(/\s*&lt;br&gt;\s*/gi, '\n');
    
    return cleanSearchArtifactsFromContent(cleaned);
  }
  
  if (typeof content === 'object' && content !== null) {
    if (Array.isArray(content)) {
      return content
        .map(item => {
          if (typeof item === 'string') {
            let cleaned = item.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;br\s*\/?&gt;/gi, '\n');
            return cleanSearchArtifactsFromContent(cleaned);
          }
          if (item.type === 'text' && item.text) {
            let cleaned = item.text.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;br\s*\/?&gt;/gi, '\n');
            return cleanSearchArtifactsFromContent(cleaned);
          }
          if (item.text && typeof item.text === 'string') {
            let cleaned = item.text.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;br\s*\/?&gt;/gi, '\n');
            return cleanSearchArtifactsFromContent(cleaned);
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    
    if (content.text && typeof content.text === 'string') {
      let cleaned = content.text.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;br\s*\/?&gt;/gi, '\n');
      return cleanSearchArtifactsFromContent(cleaned);
    }
    
    if (typeof content.content === 'string') {
      let cleaned = content.content.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;br\s*\/?&gt;/gi, '\n');
      return cleanSearchArtifactsFromContent(cleaned);
    }
    
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return '[Complex content - cannot display]';
    }
  }
  
  return String(content || '');
};

export const cleanSearchArtifactsFromContent = (text: string): string => {
  // CRITICAL: Check for all types of file links
  if (hasFileLinks(text)) {
    console.log('Skipping aggressive cleaning due to file links presence');
    return cleanMinimal(text);
  }
  
  // Regular aggressive cleaning when no file links
  let cleaned = text;
  
  cleaned = cleaned.replace(/\[Current Web Information[^\]]*\]:\s*/gi, '');
  cleaned = cleaned.replace(/Web Summary:\s*[^\n]*\n/gi, '');
  cleaned = cleaned.replace(/Top Search Results:\s*\n[\s\S]*?Instructions:[^\n]*\n/gi, '');
  cleaned = cleaned.replace(/Instructions: Please incorporate this current web information[^\n]*\n?/gi, '');
  cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\d+\.\s+\[PDF\]\s+[^\n]*\n\s*[^\n]*\.\.\.\s*Source:\s*https?:\/\/[^\s]+\s*/gi, '');
  cleaned = cleaned.replace(/\d+\.\s+[^.]+\.\.\.\s*Source:\s*https?:\/\/[^\s]+\s*/gi, '');
  cleaned = cleaned.replace(/^\s*---\s*\n/gm, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/^\s+|\s+$/g, '');
  
  return cleaned;
};

/**
 * Minimal cleaning that preserves file links
 */
export const cleanMinimal = (text: string): string => {
  let cleaned = text;
  
  // Only remove the most obvious instruction patterns
  cleaned = cleaned.replace(/IMPORTANT:\s*Please provide a natural response[^.]*\./gi, '');
  cleaned = cleaned.replace(/\[INTERNAL SEARCH CONTEXT[^\]]*\]:[^]*?\[END SEARCH CONTEXT\]/gi, '');
  cleaned = cleaned.replace(/Instructions: Please incorporate[^\n]*\n?/gi, '');
  cleaned = cleaned.replace(/\[Note: Web search was requested[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/You have access to current web search results[^\n]*\n?/gi, '');
  cleaned = cleaned.replace(/Please format your response as a valid JSON[^\n]*\n?/gi, '');
  
  // Gentle formatting cleanup
  cleaned = cleaned.replace(/\n{5,}/g, '\n\n\n');
  cleaned = cleaned.trim();
  
  return cleaned;
};

/**
 * Check if content has any type of file links
 */
export const hasFileLinks = (content: string): boolean => {
  if (typeof content !== 'string') return false;
  
  // Check for all types of file links
  return content.includes('/api/files/') || 
         content.includes('sandbox:/') || 
         content.includes('sandbox://') ||
         content.includes('blob.vercel-storage.com') ||
         content.includes('vercel-storage.com');
};

/**
 * Map sandbox URLs to downloadable URLs
 */
export const mapSandboxUrlsToDownloadable = (
  content: string, 
  fileMapping: Map<string, string>
): string => {
  if (!content || typeof content !== 'string') return content;
  if (fileMapping.size === 0) return content;
  
  let mappedContent = content;
  const sandboxPattern = /sandbox:\/\/mnt\/data\/([^\s\)]+)/g;
  
  mappedContent = mappedContent.replace(sandboxPattern, (match, filename) => {
    // Try exact match
    if (fileMapping.has(match)) {
      return fileMapping.get(match)!;
    }
    
    // Try filename match
    if (fileMapping.has(filename)) {
      return fileMapping.get(filename)!;
    }
    
    // Try partial match
    const partialMatch = Array.from(fileMapping.keys()).find(key => {
      if (typeof key !== 'string') return false;
      return filename.includes(key) || key.includes(filename);
    });
    
    if (partialMatch) {
      return fileMapping.get(partialMatch)!;
    }
    
    console.warn(`No mapping found for sandbox URL: ${match}`);
    return match;
  });
  
  return mappedContent;
};

/**
 * Extract tables from markdown content
 */
export const extractTables = (content: string): string[] => {
  const tables: string[] = [];
  const tableRegex = /\|[^|\n]*\|[^|\n]*\|[\s\S]*?(?=\n\n|\n[A-Z]|$)/g;
  let match;
  
  while ((match = tableRegex.exec(content)) !== null) {
    tables.push(match[0]);
  }
  
  return tables;
};

/**
 * Extract code blocks from content
 */
export const extractCodeBlocks = (content: string): Array<{ lang: string; code: string }> => {
  const codeBlocks: Array<{ lang: string; code: string }> = [];
  const codeRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  
  while ((match = codeRegex.exec(content)) !== null) {
    codeBlocks.push({
      lang: match[1] || 'plaintext',
      code: match[2]
    });
  }
  
  return codeBlocks;
};

/**
 * Extract all links from content
 */
export const extractLinks = (content: string): Array<{ text: string; url: string }> => {
  const links: Array<{ text: string; url: string }> = [];
  
  // Markdown links
  const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  
  while ((match = mdLinkRegex.exec(content)) !== null) {
    links.push({
      text: match[1],
      url: match[2]
    });
  }
  
  // Plain URLs
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  let urlMatch: RegExpExecArray | null;
  
  while ((urlMatch = urlRegex.exec(content)) !== null) {
    const url = urlMatch[0];
    // Only add if not already in markdown link
    if (!links.some(link => link.url === url)) {
      links.push({
        text: url,
        url: url
      });
    }
  }
  
  return links;
};

/**
 * Check if content has search artifacts
 */
export const hasSearchArtifacts = (content: string): boolean => {
  const patterns = [
    /\[INTERNAL SEARCH CONTEXT/i,
    /\[Current Web Information/i,
    /Web Summary:/i,
    /Top Search Results:/i,
    /IMPORTANT: Please provide a natural response/i,
    /Instructions: Please incorporate/i,
    /\[Note: Web search was requested/i
  ];
  
  return patterns.some(pattern => pattern.test(content));
};

/**
 * Clean content for export
 */
export const cleanForExport = (content: string): string => {
  // Preserve file links but clean everything else
  if (hasFileLinks(content)) {
    return cleanMinimal(content);
  }
  
  // Aggressive cleaning for export without file links
  let cleaned = cleanSearchArtifactsFromContent(content);
  
  // Additional export cleaning
  cleaned = cleaned.replace(/^#+\s*$/gm, ''); // Remove empty headers
  cleaned = cleaned.replace(/^\*\s*$/gm, ''); // Remove empty list items
  cleaned = cleaned.replace(/^\s*-\s*$/gm, ''); // Remove empty bullets
  
  return cleaned;
};