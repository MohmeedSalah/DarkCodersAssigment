import { readError } from './agent.ts';
export function transcriptionUrl(base: string) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS transcription server without embedded credentials.');
  return `${url.href.replace(/\/$/, '')}/audio/transcriptions`;
}
export async function transcribeLocal(file: File, base: string, model: string, onPartial: (text: string) => void, signal: AbortSignal) {
  const form = new FormData(); form.append('file', file); form.append('model', model); form.append('response_format', 'json');
  try {
    const response = await fetch(transcriptionUrl(base), { method: 'POST', body: form, signal });
    if (!response.ok) throw new Error(await readError(response, `Local ASR returned ${response.status}`));
    const data: unknown = await response.json();
    const text = data && typeof data === 'object' && 'text' in data && typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) throw new Error('Local ASR returned no transcript.');
    onPartial(text); return text;
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof Error && (error.message.includes("429") || error.message.includes("الكوتا") || error.message.includes("Quota"))) {
      throw error;
    }
    // Graceful fallback to gateway transcribe when local Whisper server is unreachable
    const { transcribeRecording } = await import('./agent.ts');
    return transcribeRecording(file, onPartial, signal);
  }
}
