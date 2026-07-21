import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { RuleCard, VulnClass } from '../types';

// 룰 저장소 — rules/*.yaml 카드를 로드해 보관하고 조회 편의를 제공한다(Repository 패턴).
// 예전에는 곳곳에서 `rules.filter(...)`·`new Map(rules.map(...))`를 반복했으나,
// 조회 책임을 이 클래스로 모아 중복을 제거했다(DRY·SRP). 룰은 데이터 카드이므로
// 새 취약점 클래스를 더하려면 카드만 추가하면 된다(OCP; DESIGN.md §15).
export class RuleRepository {
  private readonly byClassMap: Map<VulnClass, RuleCard>;

  constructor(readonly all: RuleCard[]) {
    this.byClassMap = new Map(all.map((r) => [r.class, r]));
  }

  // Load all rule cards from the rules/ directory.
  static load(rulesDir?: string): RuleRepository {
    const dir = rulesDir || path.resolve(__dirname, '../../rules');
    if (!fs.existsSync(dir)) {
      console.error(`[rules] directory not found: ${dir}`);
      return new RuleRepository([]);
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
    return new RuleRepository(cards);
  }

  byDetector(detector: RuleCard['detector']): RuleCard[] {
    return this.all.filter((r) => r.detector === detector);
  }

  firstByDetector(detector: RuleCard['detector']): RuleCard | undefined {
    return this.all.find((r) => r.detector === detector);
  }

  byClass(cls: VulnClass): RuleCard | undefined {
    return this.byClassMap.get(cls);
  }
}
