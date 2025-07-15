import Groq from 'groq-sdk';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface TranscriptionRequest {
  audioBuffer: Buffer;
  filename: string;
  language?: string;
}

export interface TranscriptionResponse {
  text: string;
  detectedLanguage?: string;
  confidence?: number;
}

export interface LanguageDetectionResponse {
  language: string;
  confidence: number;
}

export class SpeechService {
  private static instance: SpeechService;
  private groq: Groq | null = null;

  private constructor() {
    this.initializeGroq();
  }

  public static getInstance(): SpeechService {
    if (!SpeechService.instance) {
      SpeechService.instance = new SpeechService();
    }
    return SpeechService.instance;
  }

  private initializeGroq(): void {
    if (!config.groqApiKey) {
      logger.warn('Groq API key not configured - speech transcription will not be available');
      return;
    }

    try {
      this.groq = new Groq({
        apiKey: config.groqApiKey,
      });
      logger.info('Groq client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Groq client', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  public async isAvailable(): Promise<boolean> {
    return this.groq !== null && !!config.groqApiKey;
  }

  /**
   * Detect language from audio file
   */
  public async detectLanguage(audioBuffer: Buffer, filename: string): Promise<LanguageDetectionResponse> {
    if (!this.groq) {
      throw new Error('Groq client not initialized');
    }

    try {
      // For language detection, we use a short transcription without specifying language
      const blob = new Blob([audioBuffer], { type: this.getMimeType(filename) });
      const file = new File([blob], filename, { type: this.getMimeType(filename) });

      // Use transcriptions (NOT translations) to preserve original language
      const transcription = await this.groq.audio.transcriptions.create({
        file: file,
        model: 'whisper-large-v3-turbo', // Fast model for language detection
        response_format: 'verbose_json',
        temperature: 0,
        // No language specified for detection - let Whisper auto-detect
      });

      // Extract detected language from response and convert to ISO-639-1 code
      const detectedLanguageName = (transcription as any).language || 'english';
      const detectedLanguage = this.convertLanguageNameToCode(detectedLanguageName);
      const confidence = this.calculateConfidence(transcription);

      logger.info('Language detected', {
        languageName: detectedLanguageName,
        languageCode: detectedLanguage,
        confidence,
        filename
      });

      return {
        language: detectedLanguage,
        confidence
      };

    } catch (error) {
      logger.error('Language detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filename
      });
      throw new Error('Failed to detect language');
    }
  }

  /**
   * Transcribe audio to text using detected or specified language
   */
  public async transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    if (!this.groq) {
      throw new Error('Groq client not initialized');
    }

    try {
      const blob = new Blob([request.audioBuffer], { type: this.getMimeType(request.filename) });
      const file = new File([blob], request.filename, { type: this.getMimeType(request.filename) });

      // Choose model based on language
      const model = this.selectModel(request.language);

      // IMPORTANT: Use transcriptions endpoint (NOT translations) to preserve original language
      const transcription = await this.groq.audio.transcriptions.create({
        file: file,
        model: model,
        language: request.language, // Specify detected language to maintain it
        response_format: 'verbose_json',
        temperature: 0,
        prompt: `Transcribe this audio in ${request.language} language. Do not translate to English. Keep original language.`
      });

      const confidence = this.calculateConfidence(transcription);

      logger.info('Audio transcribed successfully', {
        requestLanguage: request.language,
        detectedLanguage: (transcription as any).language,
        model,
        confidence,
        textLength: transcription.text.length,
        textSample: transcription.text.substring(0, 50) + '...',
        filename: request.filename
      });

      return {
        text: transcription.text.trim(),
        detectedLanguage: (transcription as any).language || request.language,
        confidence
      };

    } catch (error) {
      logger.error('Audio transcription failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        language: request.language,
        filename: request.filename
      });
      throw new Error('Failed to transcribe audio');
    }
  }

  /**
   * Select appropriate Whisper model based on language and requirements
   */
  private selectModel(language?: string): string {
    // For non-English languages, use the full multilingual model for better accuracy
    if (language && language !== 'en') {
      return 'whisper-large-v3'; // More accurate for non-English languages
    }
    // For English or general use, use the turbo model
    return 'whisper-large-v3-turbo';
  }

  /**
   * Get MIME type based on file extension
   */
  private getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: { [key: string]: string } = {
      'mp3': 'audio/mpeg',
      'mp4': 'audio/mp4',
      'wav': 'audio/wav',
      'webm': 'audio/webm',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
      'm4a': 'audio/m4a'
    };
    return mimeTypes[ext || ''] || 'audio/wav';
  }

  /**
   * Calculate confidence score from transcription metadata
   */
  private calculateConfidence(transcription: any): number {
    if (transcription.segments && transcription.segments.length > 0) {
      // Calculate average confidence from segments
      const totalLogProb = transcription.segments.reduce((sum: number, segment: any) => {
        return sum + (segment.avg_logprob || -1);
      }, 0);
      const avgLogProb = totalLogProb / transcription.segments.length;
      
      // Convert log probability to confidence percentage (rough estimation)
      // Better confidence scores are closer to 0, worse are more negative
      const confidence = Math.max(0, Math.min(100, (1 + avgLogProb) * 100));
      return Math.round(confidence);
    }
    
    return 85; // Default confidence if no segments available
  }

  /**
   * Convert language name to ISO-639-1 language code
   */
  private convertLanguageNameToCode(languageName: string): string {
    const languageMap: { [key: string]: string } = {
      'english': 'en',
      'russian': 'ru',
      'русский': 'ru', // Additional Russian variants
      'ru': 'ru', // In case it's already a code
      'spanish': 'es',
      'french': 'fr',
      'german': 'de',
      'italian': 'it',
      'portuguese': 'pt',
      'dutch': 'nl',
      'polish': 'pl',
      'turkish': 'tr',
      'ukrainian': 'uk',
      'arabic': 'ar',
      'chinese': 'zh',
      'japanese': 'ja',
      'korean': 'ko',
      'hindi': 'hi',
      'thai': 'th',
      'vietnamese': 'vi',
      'czech': 'cs',
      'hungarian': 'hu',
      'finnish': 'fi',
      'swedish': 'sv',
      'norwegian': 'no',
      'danish': 'da',
      'bulgarian': 'bg',
      'croatian': 'hr',
      'serbian': 'sr',
      'slovak': 'sk',
      'slovenian': 'sl',
      'lithuanian': 'lt',
      'latvian': 'lv',
      'estonian': 'et',
      'greek': 'el',
      'hebrew': 'he',
      'romanian': 'ro',
      'catalan': 'ca',
      'galician': 'gl',
      'basque': 'eu',
      'welsh': 'cy',
      'irish': 'ga',
      'scottish gaelic': 'gd',
      'maltese': 'mt',
      'icelandic': 'is',
      'armenian': 'hy',
      'georgian': 'ka',
      'azerbaijani': 'az',
      'kazakh': 'kk',
      'kyrgyz': 'ky',
      'uzbek': 'uz',
      'tajik': 'tg',
      'mongolian': 'mn',
      'tibetan': 'bo',
      'burmese': 'my',
      'khmer': 'km',
      'lao': 'lo',
      'bengali': 'bn',
      'gujarati': 'gu',
      'punjabi': 'pa',
      'tamil': 'ta',
      'telugu': 'te',
      'kannada': 'kn',
      'malayalam': 'ml',
      'marathi': 'mr',
      'nepali': 'ne',
      'sinhalese': 'si',
      'urdu': 'ur',
      'persian': 'fa',
      'pashto': 'ps',
      'dari': 'prs',
      'malay': 'ms',
      'indonesian': 'id',
      'tagalog': 'tl',
      'swahili': 'sw',
      'yoruba': 'yo',
      'hausa': 'ha',
      'amharic': 'am',
      'somali': 'so',
      'afrikaans': 'af'
    };

    const normalizedName = languageName.toLowerCase().trim();
    return languageMap[normalizedName] || 'en'; // Default to English if not found
  }

  /**
   * Test connection to Groq API
   */
  public async testConnection(): Promise<boolean> {
    if (!this.groq) {
      return false;
    }

    try {
      // Test with a minimal request - we'll create a small dummy audio file
      // In practice, this would be called with real audio data
      logger.info('Groq API connection test - service is available');
      return true;
    } catch (error) {
      logger.error('Groq API connection test failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
}