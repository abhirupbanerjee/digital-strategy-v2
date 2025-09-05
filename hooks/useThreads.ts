// hooks/useThreads.ts - FIXED VERSION
import { useState, useCallback } from 'react';
import { Thread, Message } from '../types/entities.types';
import { ThreadService } from '../services/threadService';
import { formatErrorMessage, logError } from '../utils/errorHandler';
import { cleanSearchArtifactsFromContent } from '../utils/contentUtils';
import { generateContextualTitle } from '../utils/threadUtils';

export const useThreads = () => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);

  const loadThread = useCallback(async (threadId: string, limit: number = 100): Promise<Message[]> => {
    setLoading(true);
    try {
      // Pass limit parameter to API
      const response = await fetch(`/api/threads?threadId=${threadId}&limit=${limit}`);
      
      if (!response.ok) {
        throw new Error('Failed to load thread messages');
      }
      
      const data = await response.json();
      
      if (data.thread?.messages) {
        // Messages come pre-cleaned from the API, just return them
        console.log(`Loaded ${data.thread.messages.length} messages from thread`);
        return data.thread.messages;
      }
      
      return [];
    } catch (error) {
      logError(error, 'Load thread');
      throw new Error(formatErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const saveThread = useCallback(async (
    threadId: string,
    projectId: string,
    messages: Message[]
  ) => {
    try {
      const smartTitle = generateContextualTitle(messages);
      
      // Create thread object matching what API expects
      const threadData = {
        id: threadId,
        projectId,
        title: smartTitle,
        messages // Pass messages for metadata calculation
      };

      // Call ThreadService with the correct structure
      await ThreadService.saveThread(threadData as any);
      
      // Create Thread object for local state
      const thread: Thread = {
        id: threadId,
        projectId,
        title: smartTitle,
        lastMessage: messages[messages.length - 1]?.content?.substring(0, 100) || '',
        createdAt: new Date().toISOString()
      };
      
      setThreads(prev => {
        // Remove any existing thread with same ID
        const filtered = prev.filter(t => t.id !== threadId);
        // Add the new/updated thread
        return [...filtered, thread];
      });
      
      return thread;
    } catch (error) {
      logError(error, 'Save thread');
      throw new Error(formatErrorMessage(error));
    }
  }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    try {
      await ThreadService.deleteThread(threadId);
      setThreads(prev => prev.filter(t => t.id !== threadId));
    } catch (error) {
      logError(error, 'Delete thread');
      throw new Error(formatErrorMessage(error));
    }
  }, []);

  const updateThreadsFromProject = useCallback((projectThreads: any[], projectId: string) => {
    const newThreads = projectThreads.map((t: any) => {
      // Handle both string IDs and thread objects
      if (typeof t === 'string') {
        // If t is just a thread ID string, create minimal thread object
        return {
          id: t,
          projectId,
          title: 'Loading...',
          lastMessage: '',
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString()
        };
      }
      
      // If t is an object, map the properties
      const title = t.title || t.name || 'Untitled';
      const lastMessage = t.last_message || t.lastMessage || '';
      
      return {
        id: t.id || t.thread_id,
        projectId,
        title: title,
        lastMessage: lastMessage !== title ? lastMessage : '', // Avoid duplicate display
        createdAt: t.created_at || t.createdAt || new Date().toISOString(),
        lastActivity: t.last_activity || t.lastActivity || t.created_at || new Date().toISOString()
      };
    }).filter(t => t.id);
    
    setThreads(prev => {
      // Create a Map to ensure unique threads by ID
      const threadMap = new Map<string, Thread>();
      
      // Add new threads to map (these take priority)
      newThreads.forEach(thread => {
        threadMap.set(thread.id, thread);
      });
      
      // Only add previous threads that aren't in the new set and belong to different projects
      prev.forEach((thread: Thread) => {
        if (!threadMap.has(thread.id) && thread.projectId !== projectId) {
          threadMap.set(thread.id, thread);
        }
      });
      
      return Array.from(threadMap.values());
    });
  }, []);

  return {
    threads,
    loading,
    setThreads,
    loadThread,
    saveThread,
    deleteThread,
    updateThreadsFromProject
  };
};