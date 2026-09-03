/**
 * Spintax parser utility.
 * Resolves curly-brace text options separated by vertical bars, supporting nested levels.
 * Example: "{Hi|Hello} there! This is {awesome|incredible}."
 */
export function parseSpintax(text: string): string {
  const spintaxPattern = /\{([^{}]+)\}/g;
  let matches = spintaxPattern.exec(text);
  while (matches) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    spintaxPattern.lastIndex = 0; // Reset index to check again
    matches = spintaxPattern.exec(text);
  }
  return text;
}
