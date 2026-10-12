import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const hash=async(file)=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const inside=(root,file)=>{const relative=path.relative(root,file);return relative==='' || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative));};
const absent=async(file)=>{try{await fs.lstat(file);throw new Error('Destination already exists; choose a new directory.');}catch(e){if(e.code!=='ENOENT') throw e;}};
async function manifestFiles(folder) {
  const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
  if(manifest.version!==1 || !Array.isArray(manifest.files) || !manifest.files.some((f)=>f.name==='quotes.db')) throw new Error('Unsupported backup manifest.');
  const seen=new Set();
  for(const f of manifest.files) {
    if(typeof f.name!=='string' || !/^(quotes\.db|uploads\/[A-Za-z0-9._-]+)$/.test(f.name) || seen.has(f.name)) throw new Error('Invalid backup file path.');seen.add(f.name);
    const filename=path.join(folder,f.name),real=await fs.realpath(filename);
    if(!inside(await fs.realpath(folder),real) || await hash(filename)!==f.sha256) throw new Error('Backup integrity check failed.');
  }
  return manifest;
}
export async function backupData(dataDir,destination) {
  const root=path.resolve(dataDir),dest=path.resolve(destination);if(inside(root,dest)) throw new Error('Backup destination must be outside DATA_DIR.');await absent(dest);
  await fs.mkdir(path.dirname(dest),{recursive:true});const staging=`${dest}.staging-${randomUUID()}`;
  await fs.mkdir(path.join(staging,'uploads'),{recursive:true,mode:0o700});await fs.chmod(staging,0o700);
  let source,snapshot;
  try {
    source=new Database(path.join(root,'quotes.db'),{readonly:true,fileMustExist:true});await source.backup(path.join(staging,'quotes.db'));source.close();source=null;
    snapshot=new Database(path.join(staging,'quotes.db'),{readonly:true});if(snapshot.pragma('quick_check',{simple:true})!=='ok') throw new Error('Database integrity check failed.');
    const refs=snapshot.prepare('SELECT file_path FROM quotes WHERE file_path IS NOT NULL').all();snapshot.close();snapshot=null;
    const files=['quotes.db'];
    for(const {file_path:file} of refs) {
      if(!inside(path.join(root,'uploads'),path.resolve(file))) throw new Error('A stored source file is outside the uploads directory.');
      const real=await fs.realpath(file),uploadRoot=await fs.realpath(path.join(root,'uploads'));
      if(!inside(uploadRoot,real)) throw new Error('Source upload resolves outside the uploads directory.');
      const name=`uploads/${path.basename(file)}`;if(files.includes(name)) continue;
      if(!/^uploads\/[A-Za-z0-9._-]+$/.test(name)) throw new Error('Unsupported upload filename in backup.');
      await fs.copyFile(file,path.join(staging,name));files.push(name);
    }
    const manifest={version:1,created_at:new Date().toISOString(),files:[]};
    for(const name of files){const filename=path.join(staging,name);await fs.chmod(filename,0o600);manifest.files.push({name,sha256:await hash(filename),size:(await fs.stat(filename)).size});}
    await fs.writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});await absent(dest);await fs.rename(staging,dest);return manifest;
  }catch(e){source?.close();snapshot?.close();await fs.rm(staging,{recursive:true,force:true});throw e;}
}
export async function restoreData(backupDir,destination) {
  const folder=path.resolve(backupDir),dest=path.resolve(destination);if(inside(folder,dest)) throw new Error('Restore destination must be outside the backup.');await absent(dest);
  const manifest=await manifestFiles(folder),staging=`${dest}.staging-${randomUUID()}`;await fs.mkdir(path.dirname(dest),{recursive:true});await fs.mkdir(path.join(staging,'uploads'),{recursive:true,mode:0o700});await fs.chmod(staging,0o700);
  let restored;
  try{
    for(const f of manifest.files){await fs.copyFile(path.join(folder,f.name),path.join(staging,f.name));await fs.chmod(path.join(staging,f.name),0o600);}
    restored=new Database(path.join(staging,'quotes.db'));
    if(restored.pragma('quick_check',{simple:true})!=='ok') throw new Error('Database integrity check failed.');
    for(const q of restored.prepare('SELECT id,file_path FROM quotes WHERE file_path IS NOT NULL').all()) {
      const name=`uploads/${path.basename(q.file_path)}`;if(!manifest.files.some((f)=>f.name===name)) throw new Error('Backup is missing a referenced source upload.');
      restored.prepare('UPDATE quotes SET file_path=? WHERE id=?').run(path.join(dest,name),q.id);
    }
    restored.close();restored=null;await fs.writeFile(path.join(staging,'restore.json'),JSON.stringify({restored_at:new Date().toISOString(),backup_created_at:manifest.created_at},null,2),{mode:0o600});await absent(dest);await fs.rename(staging,dest);return manifest;
  }catch(e){restored?.close();await fs.rm(staging,{recursive:true,force:true});throw e;}
}
