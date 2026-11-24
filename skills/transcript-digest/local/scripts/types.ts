export interface Snippet {
  text: string;
  start: number;
  duration: number;
}

export interface Sentence {
  text: string;
  start: string;
  end: string;
}

export interface TranscriptLanguage {
  language: string;
  languageCode: string;
}

export interface TranscriptInfo {
  language: string;
  languageCode: string;
  isGenerated: boolean;
  isTranslatable: boolean;
  baseUrl: string;
  translationLanguages: TranscriptLanguage[];
}

export interface Chapter {
  title: string;
  start: number;
  end: number;
}

export interface LanguageMeta {
  code: string;
  name: string;
  isGenerated: boolean;
}

export interface VideoMeta {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  description: string;
  duration: number;
  publishDate: string;
  url: string;
  coverImage: string;
  thumbnailUrl: string;
  language: LanguageMeta;
  chapters: Chapter[];
}

export interface Options {
  inputFile: string;
  title: string;
  channel: string;
  url: string;
  date: string;
  output: string;
  outputDir: string;
  timestamps: boolean;
}

export interface TranscriptError extends Error {
  code?: string;
}
