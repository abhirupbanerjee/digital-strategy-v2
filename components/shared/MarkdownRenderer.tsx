// components/shared/MarkdownRenderer.tsx
import React, { FC } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  variant?: 'chat' | 'shared' | 'export';
  isMobile?: boolean;
  className?: string;
}

/**
 * Unified Markdown Renderer that preserves existing chat formatting
 * Maintains exact table rendering from original MarkdownMessage component
 */
export const MarkdownRenderer: FC<MarkdownRendererProps> = ({
  content,
  variant = 'chat',
  isMobile = false,
  className = ''
}) => {
  // Use existing chat message classes to maintain formatting
  const baseClassName = variant === 'chat' ? 'message-content chat-message' : '';
  
  return (
    <div className={`${baseClassName} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // HEADERS - Exact match to existing component
          h1: ({ children, ...props }) => (
            <h1 className="text-xl md:text-2xl font-bold mt-4 md:mt-6 mb-3 md:mb-4 text-gray-900" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-lg md:text-xl font-semibold mt-3 md:mt-5 mb-2 md:mb-3 text-gray-800" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-base md:text-lg font-semibold mt-3 md:mt-4 mb-2 text-gray-800" {...props}>
              {children}
            </h3>
          ),
          
          // PARAGRAPHS - Exact match including block element handling
          p: ({ children, ...props }) => {
            const hasBlockElements = React.Children.toArray(children).some(child => {
              if (React.isValidElement(child)) {
                const type = child.type;
                return typeof type === 'string' && 
                  ['div', 'pre', 'table', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(type);
              }
              return false;
            });

            if (hasBlockElements) {
              return (
                <div className="mb-3 md:mb-4 leading-relaxed text-sm md:text-base text-gray-700" {...props}>
                  {children}
                </div>
              );
            }

            return (
              <p className="mb-3 md:mb-4 leading-relaxed text-sm md:text-base text-gray-700" {...props}>
                {children}
              </p>
            );
          },
          
          // LINKS - Exact match including citation and file download handling
          a: ({ href, children, ...props }) => {
            const isCitation = href?.startsWith('http');
            const isFileDownload = href?.startsWith('/api/files/');
            
            if (isFileDownload) {
              return (
                <a 
                  href={href}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline"
                  {...props}
                >
                  {children}
                </a>
              );
            }
            
            return (
              <a 
                href={href} 
                target="_blank" 
                rel="noopener noreferrer"
                className={isCitation 
                  ? "text-blue-600 hover:text-blue-800 underline decoration-1 hover:decoration-2 transition-colors"
                  : "text-blue-600 hover:text-blue-800 underline"
                }
                {...props}
              >
                {children}
                {isCitation && <span className="text-xs ml-1">↗</span>}
              </a>
            );
          },
          
          // CODE - Exact match
          code: ({ inline, className, children, ...props }: any) => {
            return inline ? (
              <code className="bg-gray-100 text-red-600 px-1 py-0.5 rounded text-xs md:text-sm font-mono" {...props}>
                {children}
              </code>
            ) : (
              <div className="my-3 md:my-4">
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 md:p-4 overflow-x-auto text-xs md:text-sm">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          
          // LISTS - Exact match
          ul: ({ children, ...props }) => (
            <ul className="list-disc pl-5 md:pl-6 mb-3 md:mb-4 space-y-1 md:space-y-2 text-sm md:text-base" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="list-decimal pl-5 md:pl-6 mb-3 md:mb-4 space-y-1 md:space-y-2 text-sm md:text-base" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="text-gray-700 leading-relaxed text-sm md:text-base" {...props}>
              {children}
            </li>
          ),
          
          // TABLES - CRITICAL: Exact match to preserve perfect formatting
          table: ({ children, ...props }) => (
            <div className="table-scroll-container my-4">
              <table className="min-w-full" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th className="sticky-header" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td {...props}>
              {children}
            </td>
          ),
          
          // BLOCKQUOTES - Exact match
          blockquote: ({ children, ...props }) => (
            <blockquote className="border-l-4 border-gray-300 pl-3 md:pl-4 py-2 mb-3 md:mb-4 italic text-gray-600 text-sm md:text-base" {...props}>
              {children}
            </blockquote>
          ),
          
          // IMAGES - Exact match including error handling
          img: ({ src, alt, ...props }) => {
            if (!src || (typeof src === 'string' && src.trim() === '')) {
              return <span className="text-gray-500 italic">[Image not available]</span>;
            }
            
            if (typeof src === 'string' && src.startsWith('/api/files/')) {
              return (
                <div className="my-4">
                  <img 
                    src={src} 
                    alt={alt || 'Generated Image'} 
                    className="max-w-full h-auto rounded border shadow-sm"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.parentElement?.insertAdjacentHTML(
                        'beforeend',
                        '<span class="text-gray-500 italic">[Image failed to load]</span>'
                      );
                    }}
                    {...props}
                  />
                </div>
              );
            }
            
            return (
              <img 
                src={src} 
                alt={alt || ''} 
                className="max-w-full h-auto rounded"
                {...props}
              />
            );
          },
          
          // HORIZONTAL RULES
          hr: ({ ...props }) => (
            <hr className="my-6 border-t border-gray-300" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};