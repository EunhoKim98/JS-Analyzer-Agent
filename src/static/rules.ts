import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { RuleCard } from '../types';

// Load all rule cards from the rules/ directory (DESIGN.md §15 — coverage grows
// by adding data cards, not code).
export function loadRules(rulesDir?: string): RuleCard[] {
  const dir = rulesDir || path.resolve(__dirname, '../../rules');
  if (!fs.existsSync(dir)) {
    console.error(`[rules] directory not found: ${dir}`);
    return [];
  }
  const cards: RuleCard[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    try {
      const card = YAML.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as RuleCard;
      if (card && card.class && card.detector) cards.push(card);
    } catch (e) {
      console.error(`[rules] failed to parse ${name}: ${(e as Error).message}`);
    }
  }
  return cards;
}
