import { AssetRecord } from '../types';

// assets_export.json 의 구조를 명시적 타입으로 노출한다(암묵적 ReturnType 대신).
export interface AssetsExport {
  generated_by: string;
  counts: { paths: number; apis: number; params: number; secrets: number };
  paths: string[];
  apis: string[];
  params: string[];
  secrets: Array<{
    kind?: string;
    value: string;
    classification?: 'sensitive' | 'public';
    file: string;
    line: number;
  }>;
}

// 자산 익스포터 — 원시 AssetRecord 목록을 다운스트림 소비용 구조로 정규화한다
// (DESIGN.md §9). 리포트 산출 책임을 표현별로 분리(JSON/HTML)한 결과다(SRP).
export class AssetsExporter {
  export(assets: AssetRecord[]): AssetsExport {
    const paths = AssetsExporter.uniq(assets.filter((a) => a.type === 'path').map((a) => a.value));
    const apis = AssetsExporter.uniq(assets.filter((a) => a.type === 'api').map((a) => a.value));
    const params = AssetsExporter.uniq(assets.filter((a) => a.type === 'param').map((a) => a.value));
    const secrets = assets
      .filter((a) => a.type === 'secret')
      .map((a) => ({
        kind: a.secretKind,
        value: a.value,
        classification: a.classification,
        file: a.file,
        line: a.line,
      }));
    return {
      generated_by: 'JS Analyzer Agent v0.1',
      counts: { paths: paths.length, apis: apis.length, params: params.length, secrets: secrets.length },
      paths,
      apis,
      params,
      secrets,
    };
  }

  private static uniq(xs: string[]): string[] {
    return Array.from(new Set(xs)).sort();
  }
}
