/**
 * Twitter-specific character length calculation utility.
 * Mirrors X/Twitter's counting logic:
 * - Most Latin characters (U+0000 to U+10FF) count as 1 character.
 * - Emojis, CJK (Chinese/Japanese/Korean) and higher plane characters (U+1100 and above) count as 2 characters.
 * - Any URL (http:// or https://) counts as exactly 23 characters.
 */
export function getTwitterLength(text: string): number {
  if (!text) return 0;
  
  // 1. Identify and replace all URLs with a dummy string of 23 characters
  const urlRegex = /https?:\/\/[^\s]+/g;
  let textForCount = text.replace(urlRegex, () => 'x'.repeat(23));
  
  // 2. Count weights based on unicode code points
  let count = 0;
  for (let i = 0; i < textForCount.length; i++) {
    let codePoint = textForCount.codePointAt(i);
    
    if (codePoint === undefined) continue;
    
    // If it's a surrogate pair (represented as 2 code units in JS),
    // skip the second code unit as codePointAt resolved the full character.
    if (codePoint > 0xffff) {
      i++;
    }
    
    // X weight rule:
    // U+0000 to U+10FF count as 1 character.
    // U+1100 and above count as 2 characters (includes CJK, emojis, symbols).
    if (codePoint >= 0x1100) {
      count += 2;
    } else {
      count += 1;
    }
  }
  
  return count;
}
