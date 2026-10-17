import {pool} from '../backend/src/database/pool.js';
const result = await pool.query(`SELECT al.id AS list_id, ali.id AS item_id, ali.entry_type, ali.status AS item_status, al.status AS list_status, ac.status AS cycle_status, ali.created_at, EXISTS(SELECT 1 FROM advance_installment_plans p WHERE p.original_individual_advance_id=ali.id) OR EXISTS(SELECT 1 FROM advance_installments i WHERE i.posted_advance_item_id=ali.id) AS linked FROM advance_list_items ali JOIN advance_lists al ON al.id=ali.list_id JOIN advance_cycles ac ON ac.id=al.cycle_id WHERE ali.entry_type='individual' AND ali.created_at < '2026-10-16' ORDER BY ali.created_at DESC LIMIT 5`);
console.log(result.rows);
await pool.end();
