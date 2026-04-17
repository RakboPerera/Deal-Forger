import { Router } from 'express';
import { auditLog } from '../database.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'storage', req.params.dealId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

router.get('/', (req, res) => {
  try {
    const { deal_id } = req.query;
    let sql = 'SELECT * FROM deal_documents';
    const params = [];
    if (deal_id) { sql += ' WHERE deal_id = ?'; params.push(deal_id); }
    sql += ' ORDER BY upload_date DESC';
    res.json(req.db.all(sql, ...params));
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM deal_documents WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/upload/:dealId', upload.array('files', 20), (req, res) => {
  try {
    const { dealId } = req.params;
    const deal = req.db.get('SELECT * FROM deal_pipeline WHERE deal_id = ?', dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const docs = [];
    for (const file of (req.files || [])) {
      req.db.run(
        `INSERT INTO deal_documents (deal_id, filename, file_path, extraction_status) VALUES (?, ?, ?, 'pending')`,
        dealId, file.originalname, file.path
      );
      const doc = req.db.get('SELECT * FROM deal_documents ORDER BY id DESC LIMIT 1');
      docs.push(doc);
    }

    auditLog(req.db, 'document.uploaded', 'deal_documents', dealId, 'user', { count: docs.length });
    res.status(201).json({ success: true, documents: docs });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const doc = req.db.get('SELECT * FROM deal_documents WHERE id = ?', req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    // Delete file from disk if exists
    if (doc.file_path && fs.existsSync(doc.file_path)) {
      fs.unlinkSync(doc.file_path);
    }

    req.db.run('DELETE FROM deal_documents WHERE id = ?', req.params.id);
    auditLog(req.db, 'document.deleted', 'deal_documents', req.params.id, 'user', { filename: doc.filename });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
});

export default router;
