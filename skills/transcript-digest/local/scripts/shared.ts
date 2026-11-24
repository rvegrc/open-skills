const CYRILLIC_TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

function transliterate(value: string): string {
  return value
    .split("")
    .map((ch) => {
      const lower = ch.toLowerCase();
      return lower in CYRILLIC_TRANSLIT ? CYRILLIC_TRANSLIT[lower] : ch;
    })
    .join("");
}

const STOPWORDS = new Set([
  "v", "vo", "s", "so", "k", "ko", "iz", "izo", "do", "ot", "po", "na", "za", "dlya",
  "i", "a", "no", "ili", "kak", "chto", "eto", "tak", "uzhe", "esche", "pochemu", "kotoryy",
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "how", "why",
]);

export function slugify(value: string, maxWords?: number): string {
  const slug = transliterate(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const words = slug.split("-").filter(Boolean);
  if (!maxWords) return slug || "untitled";
  const significant = words.filter((w) => !STOPWORDS.has(w));
  const pool = significant.length >= maxWords ? significant : words;
  return pool.slice(0, maxWords).join("-") || "untitled";
}

export function htmlUnescape(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

export function makeError(message: string, code?: string): Error {
  const error = new Error(message) as Error & { code?: string };
  if (code) error.code = code;
  return error;
}
