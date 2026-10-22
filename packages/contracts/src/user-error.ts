export function userErrorMessage(error:unknown):string{
  let message=error && typeof error==='object' && 'message' in error?String(error.message):String(error??'');
  const wrapper=/^(?:(?:Error|TypeError|RangeError|ReferenceError|SyntaxError):\s*|Error invoking remote method ['"][^'"]+['"]:\s*)/u;
  while(wrapper.test(message))message=message.replace(wrapper,'');
  message=message.replace(/\n\s+at\s[^\n]*/gu,'').trim();
  const code=error && typeof error==='object' && 'code' in error?String(error.code):'';
  const detail=`${code} ${message}`;
  if(/heif:|heic:|no decoding plugin|no .*plugin.*compression format/iu.test(detail))return '当前无法解码此 HEIF/HEIC 文件，缺少对应的解码支持。';
  if(/ENOENT|input file is missing|no such file or directory|(?:file|path) (?:is )?not found/iu.test(detail)){
    const file=error&&typeof error==='object'&&'path' in error?String(error.path):message.match(/input file is missing:\s*([^\r\n]+)/iu)?.[1]??message.match(/(?:open|stat|lstat|unlink|rename|copyfile)\s+'([^']+)'/u)?.[1];
    return `文件不存在或所在磁盘不可用，请确认文件位置。${file?`\n文件：${file}`:''}`;
  }
  if(/ENOSPC|disk (?:is )?full|not enough space/iu.test(detail))return '磁盘空间不足，请释放空间或更换目录后重试。';
  if(/SQLITE_BUSY|SQLITE_LOCKED|database is locked/iu.test(detail))return '数据库正在使用，请稍后重试。';
  if(/SQLITE_CORRUPT|SQLITE_NOTADB|database disk image is malformed/iu.test(detail))return '数据库无法读取，请检查磁盘，或使用数据库备份恢复。';
  if(/SQLITE_CONSTRAINT|UNIQUE constraint failed|FOREIGN KEY constraint failed/iu.test(detail))return '数据已存在或仍被其他内容引用，请检查后重试。';
  if(/EBUSY|resource busy|being used by another process/iu.test(detail))return '文件正在被其他程序使用，请关闭占用程序后重试。';
  if(/EACCES|EPERM|permission denied|access (?:is )?denied/iu.test(detail))return '没有访问权限或文件正在被占用，请检查权限并关闭占用程序后重试。';
  if(/EIO|I\/O error|input\/output error/iu.test(detail))return '文件读写失败，请检查磁盘或设备连接后重试。';
  if(/ETIMEDOUT|timed? out|timeout/iu.test(detail))return '操作超时，请稍后重试。';
  if(/ENOMEM|out of memory|insufficient memory|resource temporarily unavailable/iu.test(detail))return '处理资源暂时不足，请关闭其他占用较高的程序后重试。';
  if(/ffmpeg.*(?:unavailable|not found)|cannot find.*ffmpeg/iu.test(detail))return '视频处理组件不可用，请重新解压完整运行包后重试。';
  if(/unsupported.*(?:format|codec|compression)|unknown.*(?:codec|compression)|not supported.*(?:format|codec)/iu.test(detail))return '暂不支持此文件的格式或编码，请尝试兼容模式或转换格式。';
  if(/invalid data|corrupt|truncated|premature|failed to decode|unable to decode|bad (?:jpeg|png|image)/iu.test(detail))return '文件无法解码，可能已损坏或格式不受支持，请检查文件是否完整。';
  if(/core host exited|core command failed|service.*(?:unavailable|disconnected)|channel closed/iu.test(detail))return '后台服务已中断，请重新启动软件后重试。';
  if(error&&typeof error==='object'&&'issues' in error || /"code"\s*:\s*"(?:invalid_|too_big|too_small)/u.test(message))return '输入内容不符合要求，请检查后重试。';
  if(/AbortError|operation was aborted|operation.*cancelled/iu.test(detail))return '操作已取消。';
  if(/同步 Windows 隐藏属性失败/u.test(message))return '同步 Windows 隐藏属性失败，请确认文件可以访问后重试。';
  message=message.replace(/Unknown error/giu,'未能获取具体原因');
  // Existing business errors are already written for users. File names and
  // format names may legitimately contain Latin characters.
  const description=message.replace(/[a-z]:[\\/][^\r\n]*/giu,'');
  if(/[\u3400-\u9fff]/u.test(description))return message;
  return '操作未完成，请重试；若仍失败，可查看诊断日志。';
}
