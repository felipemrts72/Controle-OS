import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { makeZip, verifyVacationFile } from '../backend/src/services/vacationDocumentService.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');

test('PDF e PNG sintéticos passam por MIME, extensão e assinatura', () => {
  assert.equal(verifyVacationFile(pdf,'application/pdf','recibo.pdf').mime,'application/pdf');
  assert.equal(verifyVacationFile(png,'image/png','recibo.png').mime,'image/png');
  assert.match(createHash('sha256').update(pdf).digest('hex'),/^[a-f0-9]{64}$/);
});

test('upload rejeita extensão, MIME, assinatura e excesso de tamanho', () => {
  assert.throws(() => verifyVacationFile(pdf,'application/pdf','recibo.exe'));
  assert.throws(() => verifyVacationFile(pdf,'image/png','recibo.png'));
  assert.throws(() => verifyVacationFile(Buffer.from('fraude'),'application/pdf','recibo.pdf'));
  assert.throws(() => verifyVacationFile(Buffer.alloc(10*1024*1024+1),'application/pdf','recibo.pdf'));
});

test('ZIP contém entradas distintas e conteúdo integral', () => {
  const zip=makeZip([{name:'periodo/a.pdf',buffer:pdf},{name:'periodo/b.png',buffer:png}]);
  assert.equal(zip.subarray(0,4).toString('hex'),'504b0304');
  assert.ok(zip.includes(pdf));
  assert.ok(zip.includes(png));
  assert.ok(zip.includes(Buffer.from('periodo/a.pdf')));
  assert.ok(zip.includes(Buffer.from('periodo/b.png')));
});
