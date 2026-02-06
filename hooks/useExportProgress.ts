import { useState, useCallback } from 'react';

export interface ExportProgress {
  type: 'progress' | 'complete' | 'error' | 'file-chunk';
  message: string;
  total?: number;
  current?: number;
  percentage?: number;
  filename?: string;
  chunk?: string;
  chunkIndex?: number;
  chunkTotal?: number;
}

export function useExportProgress() {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [fileBuffer, setFileBuffer] = useState<Uint8Array | null>(null);

  const startExport = useCallback(async (businessId: string, filters: Record<string, any>) => {
    setIsExporting(true);
    setProgress(null);
    setFileBuffer(null);

    try {
      const params = new URLSearchParams();
      params.set('businessId', businessId);
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, String(value));
        }
      });

      const response = await fetch(`/api/export-ads-progress?${params}`);
      if (!response.ok) {
        setProgress({
          type: 'error',
          message: `HTTP ${response.status}: ${response.statusText}`
        });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setProgress({
          type: 'error',
          message: 'Failed to start export stream'
        });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      const base64Chunks: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'file-chunk' && data.chunk) {
                base64Chunks.push(data.chunk);
                const pct = data.chunkTotal ? Math.min(99, Math.round((data.chunkIndex / data.chunkTotal) * 99)) : 99;
                setProgress({
                  type: 'progress',
                  message: data.message || 'Streaming file...',
                  total: data.chunkTotal,
                  current: data.chunkIndex,
                  percentage: pct,
                  filename: data.filename
                });
              } else {
                setProgress(data);
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }

      if (base64Chunks.length > 0) {
        const byteChunks: Uint8Array[] = [];
        let totalLength = 0;
        for (const chunk of base64Chunks) {
          const binaryString = atob(chunk);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i += 1) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          byteChunks.push(bytes);
          totalLength += bytes.length;
        }
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of byteChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        setFileBuffer(merged);
      }
    } catch (error) {
      console.error('Export error:', error);
      setProgress({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsExporting(false);
    }
  }, []);

  const downloadFile = useCallback(() => {
    if (!fileBuffer || !progress?.filename) return;

    const blob = new Blob([new Uint8Array(fileBuffer.buffer as ArrayBuffer, fileBuffer.byteOffset, fileBuffer.byteLength)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = progress.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [fileBuffer, progress?.filename]);

  return {
    progress,
    isExporting,
    fileBuffer,
    startExport,
    downloadFile
  };
}
