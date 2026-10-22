import {it,expect} from 'vitest';
import {userErrorMessage} from './user-error.js';
it('translates repeated HEIF codec errors into one actionable Chinese message',()=>{
 const raw='heif: Error while loading plugin: No decoding plugin installed for this compression format (11.6003)';
 expect(userErrorMessage(`${raw}\nUnknown error\n${raw}`)).toBe('当前无法解码此 HEIF/HEIC 文件，缺少对应的解码支持。');
});
it.each(['ENOENT: no such file or directory','EACCES: permission denied','ENOSPC: no space left on device','SQLITE_BUSY: database is locked','Input buffer contains unsupported image format','VipsJpeg: premature end of JPEG image','Unknown error','TypeError: Cannot read properties of undefined','Error: an unexpected library failure'])('shows Chinese for technical failures: %s',message=>{
 const result=userErrorMessage(message);expect(result).toMatch(/[\u3400-\u9fff]/u);expect(result).not.toMatch(/(?:Error|ENOENT|EACCES|ENOSPC|SQLITE_|Vips|undefined)/u);
});
it('preserves existing Chinese business messages and useful filenames while removing IPC wrappers',()=>{
 expect(userErrorMessage(new Error("Error invoking remote method 'lumina:command': Error: 标签名称已存在"))).toBe('标签名称已存在');
 expect(userErrorMessage('无法读取“IMG_20261021.heic”，请确认原文件和所在目录可用')).toBe('无法读取“IMG_20261021.heic”，请确认原文件和所在目录可用');
 expect(userErrorMessage("ENOENT: no such file or directory, open 'F:\\照片\\photo.jpg'")).toContain('文件：F:\\照片\\photo.jpg');
});
