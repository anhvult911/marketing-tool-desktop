/**
 * Spintax parser utility.
 * Resolves curly-brace text options separated by vertical bars, supporting nested levels.
 * Example: "{Hi|Hello} there! This is {awesome|incredible}."
 */
/**
 * Thay thế các biến cá nhân hóa (Merge tags / Placeholders) trong nội dung.
 * Hỗ trợ các biến như {name}, {displayName}, {uid}, {phone}, v.v. (không phân biệt hoa thường).
 */
export function applyPlaceholders(text: string, placeholders?: Record<string, string>): string {
  if (!placeholders || Object.keys(placeholders).length === 0) return text;
  let result = text;
  for (const [key, val] of Object.entries(placeholders)) {
    const regex = new RegExp(`\\{${key}\\}`, 'gi');
    result = result.replace(regex, val ?? '');
  }
  return result;
}

export function parseSpintax(text: string, placeholders?: Record<string, string>): string {
  // Thay thế placeholders trước nếu có
  let parsed = applyPlaceholders(text, placeholders);
  const spintaxPattern = /\{([^{}]+)\}/g;
  let matches = spintaxPattern.exec(parsed);
  while (matches) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    parsed = parsed.replace(matches[0], randomChoice);
    spintaxPattern.lastIndex = 0; // Reset index to check again
    matches = spintaxPattern.exec(parsed);
  }
  return parsed;
}
