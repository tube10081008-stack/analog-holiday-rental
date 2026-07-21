/**
 * 🔄 DB → MD 마이그레이션 스크립트
 * 
 * 기존 PostgreSQL에 저장된 에이전트 기억과 공유 지식을
 * MD 파일로 일괄 변환합니다.
 * 
 * 사용법: node scripts/migrate-db-to-md.js
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.prod' });

import pg from 'pg';
import {
  writeMemoryToMD,
  writeSharedKnowledgeToMD,
  buildAgentIndex,
  rebuildMasterIndex,
  rebuildGraphCache,
} from '../api/_lib/agent-wiki.js';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) {
  console.error('❌ DATABASE_URL이 설정되지 않았습니다.');
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl, max: 3 });

async function migrateMemories() {
  console.log('\n📦 [1/3] 에이전트 기억 마이그레이션...');
  
  try {
    const result = await pool.query(
      `SELECT id, agent_id, memory_type, title, content, importance, tags
       FROM agent_memories
       WHERE is_archived = FALSE
       ORDER BY agent_id, importance DESC`
    );

    let count = 0;
    for (const row of result.rows) {
      try {
        writeMemoryToMD(row.agent_id, {
          id: row.id,
          memory_type: row.memory_type,
          title: row.title,
          content: row.content,
          importance: row.importance,
          tags: row.tags || [],
        });
        count++;
      } catch (err) {
        console.warn(`  ⚠️ 건너뜀: ${row.title} — ${err.message}`);
      }
    }

    console.log(`  ✅ ${count}/${result.rows.length}건 변환 완료`);
    return count;
  } catch (err) {
    console.error(`  ❌ 기억 마이그레이션 실패:`, err.message);
    return 0;
  }
}

async function migrateSharedKnowledge() {
  console.log('\n📨 [2/3] 공유 지식 마이그레이션...');
  
  try {
    const result = await pool.query(
      `SELECT id, category, title, content, created_by, visible_to
       FROM shared_knowledge
       ORDER BY created_at DESC`
    );

    let count = 0;
    for (const row of result.rows) {
      try {
        writeSharedKnowledgeToMD({
          id: row.id,
          category: row.category,
          title: row.title,
          content: row.content,
          createdBy: row.created_by,
          visibleTo: row.visible_to || ['all'],
        });
        count++;
      } catch (err) {
        console.warn(`  ⚠️ 건너뜀: ${row.title} — ${err.message}`);
      }
    }

    console.log(`  ✅ ${count}/${result.rows.length}건 변환 완료`);
    return count;
  } catch (err) {
    console.error(`  ❌ 공유 지식 마이그레이션 실패:`, err.message);
    return 0;
  }
}

function buildIndexes() {
  console.log('\n📊 [3/3] 인덱스 & 그래프 빌드...');
  
  const agents = ['hani', 'geo', 'noah', 'lina', 'alex'];
  for (const agentId of agents) {
    buildAgentIndex(agentId);
  }
  
  const index = rebuildMasterIndex();
  const graph = rebuildGraphCache();
  
  console.log(`  ✅ 인덱스: ${index.node_count}건`);
  console.log(`  ✅ 그래프: ${graph.node_count} nodes, ${graph.edge_count} edges`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('🔄 아날로그 홀리데이 — DB→MD 마이그레이션');
  console.log('='.repeat(60));

  const memCount = await migrateMemories();
  const sharedCount = await migrateSharedKnowledge();
  buildIndexes();

  console.log('\n' + '='.repeat(60));
  console.log(`✅ 마이그레이션 완료!`);
  console.log(`   📝 기억: ${memCount}건`);
  console.log(`   📨 공유: ${sharedCount}건`);
  console.log(`   📂 경로: _brain/`);
  console.log('='.repeat(60));

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
