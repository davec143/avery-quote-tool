import {backupData,restoreData} from '../lib/backup.js';
const [operation,input,output]=process.argv.slice(2);
if(!['create','restore'].includes(operation) || !input || !output) throw new Error('Usage: node scripts/backup.mjs create <DATA_DIR> <new-backup-directory> OR restore <backup-directory> <new-DATA_DIR>');
const manifest=operation==='create' ? await backupData(input,output) : await restoreData(input,output);
console.log(`${operation==='create' ? 'Backup created' : 'Backup restored and source paths updated'}: ${output}; ${manifest.files.length} files integrity checked. Protect this directory: it contains the app database and saved provider settings.`);
