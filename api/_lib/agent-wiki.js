/**
 * 🧠 Agent Wiki — MD 파일 기반 지식 네트워크 (옵시디언 Vault)
 * 
 * LLM WIKI의 핵심 아키텍처를 에이전트 시스템에 이식:
 * - YAML Frontmatter (메타데이터 자기 설명)
 * - [[wikilink]] (옵시디언 그래프 연결)
 * - 폴더 분류 체계 (memory_type → 서브폴더)
 * - index.json + graph.cache.json (프로그래밍 가능 API)
 */

import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════════════
// 📂 경로 설정
// ═══════════════════════════════════════════════════

// Vercel 서버리스 환경에서는 /tmp 사용, 로컬에서는 프로젝트 루트
function getBrainRoot() {
  // 환경변수로 커스텀 경로 지정 가능
  if (process.env.BRAIN_ROOT) return process.env.BRAIN_ROOT;
  // Vercel 서버리스에서는 읽기 전용이므로 /tmp 사용
  if (process.env.VERCEL) return '/tmp/_brain';
  // 로컬: 프로젝트 루트의 _brain/
  return path.resolve(process.cwd(), '_brain');
}

const AGENT_IDS = ['hani', 'geo', 'noah', 'lina', 'alex'];

const AGENT_DISPLAY_NAMES = {
  hani: '하니', geo: '지오', noah: '노아', lina: '리나', alex: '알렉스',
};

const MEMORY_TYPE_FOLDERS = {
  directive: 'directives',
  fact: 'facts',
  lesson: 'lessons',
  preference: 'preferences',
  context: 'facts', // context는 facts에 통합
};

const MEMORY_TYPE_LABELS = {
  directive: '📋 지시사항',
  fact: '📊 비즈니스 사실',
  lesson: '💡 교훈',
  preference: '🎨 선호도',
  context: '📊 비즈니스 사실',
};

// ═══════════════════════════════════════════════════
// 🔧 유틸리티
// ═══════════════════════════════════════════════════

/**
 * 한글 제목을 파일명으로 변환
 * "고객 응대 시 카메라 보험 안내" → "customer-camera-insurance-guide"
 * 한글은 유지하되 특수문자/공백을 하이픈으로 치환
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\uAC00-\uD7AF\u3131-\u3163\u318E-\u31BF-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

/**
 * 안전한 디렉토리 생성 (재귀)
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * ISO 날짜 문자열 반환
 */
function today() {
  return new Date().toISOString().split('T')[0];
}

function nowISO() {
  return new Date().toISOString();
}

// ═══════════════════════════════════════════════════
// 📝 MD 파일 생성 (핵심)
// ═══════════════════════════════════════════════════

/**
 * 에이전트 기억 → MD 파일 생성
 * 
 * @param {string} agentId - 에이전트 ID (hani, geo, noah, lina, alex)
 * @param {Object} memory - 기억 객체
 * @param {string} memory.id - 기억 ID
 * @param {string} memory.memory_type - directive/fact/lesson/preference/context
 * @param {string} memory.title - 제목
 * @param {string} memory.content - 내용
 * @param {number} memory.importance - 중요도 (1-10)
 * @param {string[]} memory.tags - 태그 배열
 * @param {string[]} [memory.related] - 연관 기억 ID 배열
 * @returns {{ filePath: string, relativePath: string }} 생성된 파일 경로
 */
export function writeMemoryToMD(agentId, memory) {
  const brainRoot = getBrainRoot();
  const folder = MEMORY_TYPE_FOLDERS[memory.memory_type] || 'facts';
  const slug = slugify(memory.title);
  const dirPath = path.join(brainRoot, agentId, folder);
  const filePath = path.join(dirPath, `${slug}.md`);
  const relativePath = `_brain/${agentId}/${folder}/${slug}.md`;

  ensureDir(dirPath);

  const relatedLinks = (memory.related || [])
    .map(id => `  - "${id}"`)
    .join('\n');

  const tagsYaml = (memory.tags || [])
    .map(t => `${t}`)
    .join(', ');

  const frontmatter = `---
id: "${memory.id}"
schema_version: 1
agent_id: "${agentId}"
memory_type: "${memory.memory_type}"
title: "${memory.title.replace(/"/g, '\\"')}"
status: active
importance: ${memory.importance || 5}
confidence_score: ${memory.importance >= 8 ? 0.95 : memory.importance >= 5 ? 0.8 : 0.6}
created_at: "${today()}"
updated_at: "${today()}"
last_reinforced: "${today()}"
reinforce_count: 0
tags: [${tagsYaml}]
${relatedLinks ? `related:\n${relatedLinks}` : 'related: []'}
---`;

  const typeLabel = MEMORY_TYPE_LABELS[memory.memory_type] || '📋 기타';
  const agentName = AGENT_DISPLAY_NAMES[agentId] || agentId;

  const body = `
# [[${memory.title}]]

## 📌 핵심 요약
> ${memory.content}

## 📖 상세 정보
- **유형**: ${typeLabel}
- **중요도**: ${'⭐'.repeat(Math.min(5, Math.ceil(memory.importance / 2)))} (${memory.importance}/10)
- **에이전트**: ${agentName}
- **기록일**: ${today()}

## 🔗 지식 연결
- **에이전트**: [[${agentName}의 뇌|_index]]
${(memory.related || []).map(r => `- **관련**: [[${r}]]`).join('\n') || '- 아직 연결된 지식이 없습니다.'}
`;

  fs.writeFileSync(filePath, frontmatter + '\n' + body, 'utf-8');
  
  console.log(`[Wiki] 📝 ${agentName} 기억 저장: ${relativePath}`);
  return { filePath, relativePath };
}

/**
 * 크로스 에이전트 공유 지식 → MD 파일 생성
 * 
 * @param {Object} knowledge - 공유 지식 객체
 * @param {string} knowledge.id - 지식 ID
 * @param {string} knowledge.category - 카테고리
 * @param {string} knowledge.title - 제목
 * @param {string} knowledge.content - 내용
 * @param {string} knowledge.createdBy - 발신 에이전트 ID
 * @param {string[]} knowledge.visibleTo - 수신 에이전트 ID 배열
 * @returns {{ filePath: string, relativePath: string }}
 */
export function writeSharedKnowledgeToMD(knowledge) {
  const brainRoot = getBrainRoot();
  const fromName = AGENT_DISPLAY_NAMES[knowledge.createdBy] || knowledge.createdBy;
  const toNames = (knowledge.visibleTo || ['all'])
    .filter(v => v !== 'all')
    .map(v => AGENT_DISPLAY_NAMES[v] || v);
  
  const slug = slugify(knowledge.title);
  const toLabel = toNames.length > 0 ? toNames.join('-') : 'all';

  // 1. _shared/ 폴더에 원본 저장
  const sharedDir = path.join(brainRoot, '_shared');
  const sharedFile = path.join(sharedDir, `${knowledge.createdBy}-to-${toLabel}_${slug}.md`);
  ensureDir(sharedDir);

  const frontmatter = `---
id: "${knowledge.id}"
schema_version: 1
type: shared_knowledge
category: "${knowledge.category}"
title: "${knowledge.title.replace(/"/g, '\\"')}"
created_by: "${knowledge.createdBy}"
visible_to: [${(knowledge.visibleTo || ['all']).map(v => `"${v}"`).join(', ')}]
created_at: "${today()}"
updated_at: "${today()}"
---`;

  const body = `
# [[💌 ${fromName}→${toLabel}: ${knowledge.title}]]

## 📌 공유 내용
> ${knowledge.content}

## 📋 메타 정보
- **발신**: [[${fromName}의 뇌|${fromName}]]
- **수신**: ${toNames.map(n => `[[${n}의 뇌|${n}]]`).join(', ') || '전체 팀'}
- **카테고리**: ${knowledge.category}
- **공유일**: ${today()}

## 🔗 관련 지식
- 발신자 뇌: [[_brain/${knowledge.createdBy}/_index|${fromName}의 뇌]]
`;

  fs.writeFileSync(sharedFile, frontmatter + '\n' + body, 'utf-8');

  // 2. 수신자의 shared/ 폴더에도 복사
  const targets = (knowledge.visibleTo || []).filter(v => v !== 'all');
  if (targets.length === 0) {
    // 'all'이면 모든 에이전트에게
    for (const aid of AGENT_IDS) {
      if (aid !== knowledge.createdBy) {
        const targetDir = path.join(brainRoot, aid, 'shared');
        ensureDir(targetDir);
        fs.writeFileSync(path.join(targetDir, `from-${knowledge.createdBy}_${slug}.md`), 
          frontmatter + '\n' + body, 'utf-8');
      }
    }
  } else {
    for (const aid of targets) {
      const targetDir = path.join(brainRoot, aid, 'shared');
      ensureDir(targetDir);
      fs.writeFileSync(path.join(targetDir, `from-${knowledge.createdBy}_${slug}.md`), 
        frontmatter + '\n' + body, 'utf-8');
    }
  }

  const relativePath = `_brain/_shared/${knowledge.createdBy}-to-${toLabel}_${slug}.md`;
  console.log(`[Wiki] 📨 공유 지식 저장: ${relativePath}`);
  return { filePath: sharedFile, relativePath };
}

// ═══════════════════════════════════════════════════
// 📋 에이전트 MOC (Map of Content) 생성
// ═══════════════════════════════════════════════════

/**
 * 에이전트별 _index.md (뇌 지도) 자동 생성
 */
export function buildAgentIndex(agentId) {
  const brainRoot = getBrainRoot();
  const agentDir = path.join(brainRoot, agentId);
  const agentName = AGENT_DISPLAY_NAMES[agentId] || agentId;
  
  if (!fs.existsSync(agentDir)) {
    ensureDir(agentDir);
  }

  const sections = [];
  const allNodes = [];

  // 각 카테고리 폴더 순회
  for (const [memType, folderName] of Object.entries(MEMORY_TYPE_FOLDERS)) {
    // context와 fact이 같은 폴더이므로 중복 방지
    if (memType === 'context') continue;
    
    const folderPath = path.join(agentDir, folderName);
    if (!fs.existsSync(folderPath)) continue;

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));
    if (files.length === 0) continue;

    const label = MEMORY_TYPE_LABELS[memType] || '📋 기타';
    const links = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(folderPath, file), 'utf-8');
      const titleMatch = content.match(/^title:\s*"(.+?)"/m);
      const impMatch = content.match(/^importance:\s*(\d+)/m);
      const title = titleMatch ? titleMatch[1] : file.replace('.md', '');
      const imp = impMatch ? parseInt(impMatch[1]) : 5;

      links.push({ title, importance: imp, file: `${folderName}/${file}` });
      allNodes.push({ title, memType, importance: imp, file });
    }

    // 중요도 순 정렬
    links.sort((a, b) => b.importance - a.importance);

    sections.push(`## ${label}`);
    for (const l of links) {
      sections.push(`- [[${l.title}]] (importance: ${l.importance})`);
    }
    sections.push('');
  }

  // shared 폴더
  const sharedDir = path.join(agentDir, 'shared');
  if (fs.existsSync(sharedDir)) {
    const sharedFiles = fs.readdirSync(sharedDir).filter(f => f.endsWith('.md'));
    if (sharedFiles.length > 0) {
      sections.push('## 📨 받은 공유 지식');
      for (const file of sharedFiles) {
        const content = fs.readFileSync(path.join(sharedDir, file), 'utf-8');
        const titleMatch = content.match(/^title:\s*"(.+?)"/m);
        const title = titleMatch ? titleMatch[1] : file.replace('.md', '');
        sections.push(`- [[${title}]]`);
      }
      sections.push('');
    }
  }

  const indexContent = `---
agent_id: "${agentId}"
type: moc
generated_at: "${nowISO()}"
---

# 🧠 ${agentName}의 뇌 (${agentName}'s Brain)

> 마지막 갱신: ${today()} | 총 기억: ${allNodes.length}건

${sections.join('\n')}
`;

  const indexPath = path.join(agentDir, '_index.md');
  fs.writeFileSync(indexPath, indexContent, 'utf-8');
  console.log(`[Wiki] 📋 ${agentName} MOC 갱신: ${allNodes.length}건`);
  return { filePath: indexPath, nodeCount: allNodes.length };
}

// ═══════════════════════════════════════════════════
// 📊 전체 인덱스 + 그래프 캐시
// ═══════════════════════════════════════════════════

/**
 * 전체 에이전트의 index.json 빌드
 */
export function rebuildMasterIndex() {
  const brainRoot = getBrainRoot();
  const metaDir = path.join(brainRoot, '_meta');
  ensureDir(metaDir);

  const entries = [];

  for (const agentId of AGENT_IDS) {
    const agentDir = path.join(brainRoot, agentId);
    if (!fs.existsSync(agentDir)) continue;

    for (const folderName of [...new Set(Object.values(MEMORY_TYPE_FOLDERS))]) {
      const folderPath = path.join(agentDir, folderName);
      if (!fs.existsSync(folderPath)) continue;

      for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.md'))) {
        const content = fs.readFileSync(path.join(folderPath, file), 'utf-8');
        const idMatch = content.match(/^id:\s*"(.+?)"/m);
        const titleMatch = content.match(/^title:\s*"(.+?)"/m);
        const typeMatch = content.match(/^memory_type:\s*"(.+?)"/m);
        const impMatch = content.match(/^importance:\s*(\d+)/m);

        entries.push({
          node_id: idMatch?.[1] || file.replace('.md', ''),
          title: titleMatch?.[1] || file.replace('.md', ''),
          agent_id: agentId,
          memory_type: typeMatch?.[1] || 'fact',
          path: `_brain/${agentId}/${folderName}/${file}`,
          status: 'active',
          importance: impMatch ? parseInt(impMatch[1]) : 5,
          updated_at: today(),
        });
      }
    }
  }

  // 공유 지식도 인덱스에 포함
  const sharedDir = path.join(brainRoot, '_shared');
  if (fs.existsSync(sharedDir)) {
    for (const file of fs.readdirSync(sharedDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(sharedDir, file), 'utf-8');
      const idMatch = content.match(/^id:\s*"(.+?)"/m);
      const titleMatch = content.match(/^title:\s*"(.+?)"/m);
      const catMatch = content.match(/^category:\s*"(.+?)"/m);
      const byMatch = content.match(/^created_by:\s*"(.+?)"/m);

      entries.push({
        node_id: idMatch?.[1] || file.replace('.md', ''),
        title: titleMatch?.[1] || file.replace('.md', ''),
        agent_id: byMatch?.[1] || 'unknown',
        memory_type: 'shared',
        path: `_brain/_shared/${file}`,
        status: 'active',
        category: catMatch?.[1] || 'insight',
        updated_at: today(),
      });
    }
  }

  const index = {
    schema_version: 1,
    generated_at: nowISO(),
    node_count: entries.length,
    entries,
  };

  const indexPath = path.join(metaDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`[Wiki] 📊 마스터 인덱스 빌드: ${entries.length}건`);
  return index;
}

/**
 * 전체 그래프 캐시 빌드
 */
export function rebuildGraphCache() {
  const brainRoot = getBrainRoot();
  const metaDir = path.join(brainRoot, '_meta');
  ensureDir(metaDir);

  const nodes = [];
  const edges = [];
  const nodeIdSet = new Set();

  for (const agentId of AGENT_IDS) {
    // 에이전트 자체를 노드로
    const agentNodeId = `agent_${agentId}`;
    nodes.push({
      id: agentNodeId,
      label: `${AGENT_DISPLAY_NAMES[agentId]} (에이전트)`,
      node_kind: 'agent',
      node_type: 'agent',
      status: 'active',
    });
    nodeIdSet.add(agentNodeId);

    const agentDir = path.join(brainRoot, agentId);
    if (!fs.existsSync(agentDir)) continue;

    for (const folderName of [...new Set(Object.values(MEMORY_TYPE_FOLDERS))]) {
      const folderPath = path.join(agentDir, folderName);
      if (!fs.existsSync(folderPath)) continue;

      for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.md'))) {
        const content = fs.readFileSync(path.join(folderPath, file), 'utf-8');
        const idMatch = content.match(/^id:\s*"(.+?)"/m);
        const titleMatch = content.match(/^title:\s*"(.+?)"/m);
        const typeMatch = content.match(/^memory_type:\s*"(.+?)"/m);
        const relatedMatch = content.match(/^related:\s*\n((?:\s+-\s*".+?"\n?)+)/m);

        const nodeId = idMatch?.[1] || file.replace('.md', '');
        if (nodeIdSet.has(nodeId)) continue;

        nodes.push({
          id: nodeId,
          label: titleMatch?.[1] || file.replace('.md', ''),
          node_kind: 'memory',
          node_type: typeMatch?.[1] || 'fact',
          agent_id: agentId,
          path: `_brain/${agentId}/${folderName}/${file}`,
          status: 'active',
        });
        nodeIdSet.add(nodeId);

        // 에이전트→기억 엣지
        edges.push({
          source: agentNodeId,
          target: nodeId,
          relation: 'owns',
          weight: 1,
        });

        // related 링크 파싱
        if (relatedMatch) {
          const relIds = [...relatedMatch[1].matchAll(/"(.+?)"/g)].map(m => m[1]);
          for (const relId of relIds) {
            edges.push({
              source: nodeId,
              target: relId,
              relation: 'related',
              weight: 1,
            });
          }
        }
      }
    }
  }

  // 공유 지식 엣지
  const sharedDir = path.join(brainRoot, '_shared');
  if (fs.existsSync(sharedDir)) {
    for (const file of fs.readdirSync(sharedDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(sharedDir, file), 'utf-8');
      const idMatch = content.match(/^id:\s*"(.+?)"/m);
      const byMatch = content.match(/^created_by:\s*"(.+?)"/m);
      const toMatch = content.match(/^visible_to:\s*\[(.+?)\]/m);

      const nodeId = idMatch?.[1] || file.replace('.md', '');
      const fromAgent = byMatch?.[1];
      const toAgents = toMatch ? [...toMatch[1].matchAll(/"(\w+)"/g)].map(m => m[1]) : [];

      if (!nodeIdSet.has(nodeId)) {
        const titleMatch = content.match(/^title:\s*"(.+?)"/m);
        nodes.push({
          id: nodeId,
          label: titleMatch?.[1] || file,
          node_kind: 'shared',
          node_type: 'shared_knowledge',
          status: 'active',
        });
        nodeIdSet.add(nodeId);
      }

      // 발신 에이전트 → 공유 지식
      if (fromAgent) {
        edges.push({
          source: `agent_${fromAgent}`,
          target: nodeId,
          relation: 'shared_from',
          weight: 2,
        });
      }

      // 공유 지식 → 수신 에이전트
      for (const to of toAgents.filter(t => t !== 'all')) {
        edges.push({
          source: nodeId,
          target: `agent_${to}`,
          relation: 'shared_to',
          weight: 2,
        });
      }
    }
  }

  const graph = {
    schema_version: 1,
    generated_at: nowISO(),
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
  };

  const graphPath = path.join(metaDir, 'graph.cache.json');
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');
  console.log(`[Wiki] 🕸️ 그래프 캐시 빌드: ${nodes.length} nodes, ${edges.length} edges`);
  return graph;
}

// ═══════════════════════════════════════════════════
// 🔄 Vault 전체 리빌드
// ═══════════════════════════════════════════════════

/**
 * 모든 에이전트의 MOC + 인덱스 + 그래프를 일괄 갱신
 */
export function rebuildVault() {
  for (const agentId of AGENT_IDS) {
    buildAgentIndex(agentId);
  }
  rebuildMasterIndex();
  rebuildGraphCache();
  console.log(`[Wiki] ✅ Vault 전체 리빌드 완료`);
}
