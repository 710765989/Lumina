// User-facing service errors; technical diagnostics remain in logs.
export const backendMessages:Record<string,readonly [string,string]>={
  "缓存目录已经确认，后续请在缓存设置中更改": [
    "Cache location is already confirmed. Change it in cache settings.",
    "キャッシュの場所は確認済みです。キャッシュ設定で変更してください"
  ],
  "请选择完整的缓存目录路径": [
    "Choose a full cache directory path",
    "キャッシュのフルパスを選択してください"
  ],
  "请选择完整的图库目录路径": [
    "Choose a full library directory path",
    "ライブラリのフルパスを選択してください"
  ],
  "缓存目录不能放在图库目录内或包含图库目录": [
    "Cache and library directories must not contain one another",
    "キャッシュとライブラリを互いの内部には配置できません"
  ],
  "缓存目录不可写，请选择其他位置": [
    "Cache directory is not writable. Choose another location.",
    "キャッシュに書き込めません。別の場所を選択してください"
  ],
  "缓存磁盘空间不足，请选择其他位置": [
    "Not enough space on the cache drive. Choose another location.",
    "キャッシュ用ディスクの空き容量が不足しています。別の場所を選択してください"
  ],
  "缓存位置正在处理，请稍后再试": [
    "A cache operation is in progress. Try again shortly.",
    "キャッシュの処理中です。しばらくしてから再試行してください"
  ],
  "图库状态已经变化，请重新打开目录设置": [
    "Library state changed. Reopen directory settings.",
    "ライブラリの状態が変わりました。ディレクトリ設定を開き直してください"
  ],
  "目标缓存属于其他图库": [
    "The destination cache belongs to another library",
    "移動先のキャッシュは別のライブラリのものです"
  ],
  "请填写完整缓存目录路径": [
    "Enter a full cache directory path",
    "キャッシュのフルパスを入力してください"
  ],
  "新旧缓存目录不能相同或互相包含": [
    "Old and new cache directories must differ and not contain one another",
    "新旧のキャッシュの場所は異なる必要があり、互いの内部には配置できません"
  ],
  "缓存目录不能包含数据库或用户数据目录": [
    "Cache must not contain the database or user-data directory",
    "キャッシュ内にデータベースやユーザーデータを含めることはできません"
  ],
  "缓存路径必须是实际文件夹，不能经过目录链接": [
    "Cache path must be a real folder, without directory links",
    "キャッシュはリンクを経由しない実際のフォルダーを指定してください"
  ],
  "请选择空目录，或此前属于此图库的缓存目录": [
    "Choose an empty directory or a cache directory belonging to this library",
    "空のディレクトリか、このライブラリのキャッシュを選択してください"
  ],
  "已有缓存迁移正在执行": [
    "A cache migration is already running",
    "キャッシュの移行は既に実行中です"
  ],
  "缓存文件路径已变化，请重试": [
    "Cache file path changed. Try again.",
    "キャッシュのパスが変わりました。再試行してください"
  ],
  "当前缓存目录是链接，不能自动移动": [
    "The current cache is a link and cannot be moved automatically",
    "現在のキャッシュはリンクのため自動移動できません"
  ],
  "目标磁盘空间不足，请更换缓存目录": [
    "Not enough space at the destination. Choose another cache directory.",
    "移動先の空き容量が不足しています。別の場所を選択してください"
  ],
  "迁移预览已过期，请重新确认": [
    "Migration preview expired. Confirm again.",
    "移行のプレビューは期限切れです。再確認してください"
  ],
  "迁移已结束；需要重试时请重新选择缓存位置": [
    "Migration has ended. Choose the cache location again to retry.",
    "移行は終了しました。再試行するには場所を選び直してください"
  ],
  "缓存迁移只支持在切换前取消": [
    "Cache migration can only be cancelled before switching locations",
    "キャッシュの移行は場所の切り替え前のみキャンセルできます"
  ],
  "已切换到新缓存目录，正在完成旧缓存清理": [
    "Switched to the new cache; finishing old cache cleanup",
    "新しいキャッシュに切り替えました。古いキャッシュの整理を完了中です"
  ],
  "缓存在迁移前发生变化，请重新迁移": [
    "Cache changed before migration. Start migration again.",
    "移行前にキャッシュが変わりました。移行をやり直してください"
  ],
  "目标目录出现链接，请重新选择目录": [
    "A link appeared at the destination. Choose another directory.",
    "移動先にリンクが存在します。別のディレクトリを選択してください"
  ],
  "目标缓存不是普通文件，请重新选择目录": [
    "Destination cache is not a regular file. Choose another directory.",
    "移動先のキャッシュは通常ファイルではありません。別の場所を選択してください"
  ],
  "缓存内容校验未通过，继续使用原目录": [
    "Cache verification failed; keeping the original directory",
    "キャッシュの検証に失敗したため、元の場所を使用します"
  ],
  "视频准备已暂停，重新打开可继续": [
    "Video preparation paused; reopen to resume",
    "動画の準備を一時停止しました。再度開くと再開します"
  ],
  "视频不可用": [
    "Video unavailable",
    "動画を利用できません"
  ],
  "无法读取视频时长，建议使用其他播放器打开": [
    "Unable to read video duration. Try another player.",
    "動画の長さを取得できません。他のプレーヤーをお試しください"
  ],
  "媒体已移除或更新": [
    "Media removed or updated",
    "メディアは削除または更新されています"
  ],
  "视频准备已暂停，重新打开可从已完成片段继续": [
    "Video preparation paused; reopen to resume from completed segments",
    "動画の準備を一時停止しました。再度開くと完了済み区間から再開します"
  ],
  "请选择文件目录": [
    "Choose a file directory",
    "ファイルのディレクトリを選択してください"
  ],
  "目录已变化，请重新打开编辑页": [
    "Directory changed. Reopen the editor.",
    "ディレクトリが変わりました。編集画面を開き直してください"
  ],
  "该目录已添加，请在目录设置中编辑": [
    "This directory has already been added. Edit it in directory settings.",
    "このディレクトリは追加済みです。ディレクトリ設定で編集してください"
  ],
  "该目录仍有整理任务，请先完成或取消任务": [
    "This directory has an organization task. Finish or cancel it first.",
    "このディレクトリの整理タスクを先に完了またはキャンセルしてください"
  ],
  "所选子目录不在本次预览中，请重新预览": [
    "The subdirectory is not in this preview. Refresh the preview.",
    "選択した子ディレクトリは今回のプレビューにありません。再確認してください"
  ],
  "规则中的子目录不存在或不是实际目录": [
    "A rule refers to a missing or non-real directory",
    "ルール内の子ディレクトリが存在しないか、実際のディレクトリではありません"
  ],
  "任务不存在": [
    "Task not found",
    "タスクが見つかりません"
  ],
  "正在停止任务，请稍后恢复": [
    "Task is stopping. Wait before resuming.",
    "タスクを停止中です。再開するまでお待ちください"
  ],
  "图库目录已移除": [
    "Library directory removed",
    "ライブラリのディレクトリは削除されています"
  ],
  "重复检测结果已变化，请刷新后重新选择保留项": [
    "Duplicate results changed. Refresh and select files to keep again.",
    "重複の結果が変わりました。更新して保持するファイルを選び直してください"
  ],
  "勾选项目已变化，请刷新后重新选择": [
    "Selection changed. Refresh and select again.",
    "選択項目が変わりました。更新して選び直してください"
  ],
  "每个重复组请选择一个保留项": [
    "Select a file to keep in each duplicate group",
    "各重複グループで保持するファイルを1つ選んでください"
  ],
  "重复检测结果已变化，请关闭确认框并重新预览": [
    "Duplicate results changed. Close confirmation and preview again.",
    "重複の結果が変わりました。確認画面を閉じて再確認してください"
  ],
  "包含整组删除，请先确认这些组将不保留任何文件": [
    "Confirm that entire selected groups will have no files left",
    "グループ全体の削除によりファイルが残らないことを確認してください"
  ],
  "已取消，未执行": [
    "Cancelled before processing",
    "処理前にキャンセルしました"
  ],
  "拟保留的原文件已变化，请重新扫描和检测后再清理": [
    "A file to keep changed. Rescan and detect again before cleanup.",
    "保持予定の元ファイルが変わりました。再スキャンと検出後に整理してください"
  ],
  "保留文件正在变化，未开始清理": [
    "The file to keep is changing; cleanup has not started",
    "保持するファイルが変更中のため、整理を開始していません"
  ],
  "相似检测结果已变化，请关闭确认框并重新预览": [
    "Similarity results changed. Close confirmation and preview again.",
    "類似の結果が変わりました。確認画面を閉じて再確認してください"
  ],
  "拟保留的文件已变化，请重新运行检测后再删除相似文件": [
    "A file to keep changed. Detect again before deleting similar files.",
    "保持予定のファイルが変わりました。再検出してから類似ファイルを削除してください"
  ],
  "来源与目标相同": [
    "Source and destination are the same",
    "元と保存先が同じです"
  ],
  "文件在复制过程中变化，已保留原文件": [
    "File changed during copying; original kept",
    "コピー中にファイルが変わったため、元ファイルを保持しました"
  ],
  "文件内容已变化，已保留原文件": [
    "File contents changed; original kept",
    "内容が変わったため、元ファイルを保持しました"
  ],
  "文件在等待释放期间变化，已保留原文件": [
    "File changed while waiting for release; original kept",
    "解放を待つ間にファイルが変わったため、元ファイルを保持しました"
  ],
  "重名文件过多，请选择另一个目录": [
    "Too many name conflicts. Choose another directory.",
    "同名ファイルが多すぎます。別のディレクトリを選択してください"
  ],
  "地点任务正在处理，请等待完成后再清理": [
    "A location task is running. Wait before cleanup.",
    "位置情報の処理中です。完了してから整理してください"
  ],
  "地点分类已变化，请重新打开清理确认": [
    "Location categories changed. Reopen cleanup confirmation.",
    "場所の分類が変わりました。確認画面を開き直してください"
  ],
  "预览已取消": [
    "Preview cancelled",
    "プレビューをキャンセルしました"
  ],
  "图库目录已移除或停用，未启动扫描": [
    "Directory removed or disabled; scan not started",
    "ディレクトリが削除済みか無効のため、スキャンを開始していません"
  ],
  "请先填写默认导入路径": [
    "Set the default import path first",
    "先に既定のインポート先を入力してください"
  ],
  "请填写完整的导入目录路径": [
    "Enter a full import directory path",
    "インポート先のフルパスを入力してください"
  ],
  "不能导入到剪贴板暂存目录": [
    "Cannot import into the clipboard staging directory",
    "クリップボードの一時保存先にはインポートできません"
  ],
  "不能导入到缓存目录": [
    "Cannot import into the cache directory",
    "キャッシュのディレクトリにはインポートできません"
  ],
  "导入路径必须是实际文件夹，不能经过目录链接": [
    "Import path must be a real folder without directory links",
    "インポート先はリンクを経由しない実際のフォルダーを指定してください"
  ],
  "目标目录所在图库已停用，请先启用或更换路径": [
    "The destination library is disabled. Enable it or choose another path.",
    "保存先のライブラリが無効です。有効にするか別の場所を選択してください"
  ],
  "一次最多导入100000个媒体文件，请分批导入": [
    "Import at most 100,000 media files at a time; split into batches",
    "1回の取り込みは最大100,000ファイルです。分割してください"
  ],
  "来源文件路径无效": [
    "Invalid source file path",
    "元のファイルのパスが無効です"
  ],
  "所选内容没有可导入的照片或视频": [
    "No importable photos or videos in the selection",
    "選択内容に取り込める写真や動画がありません"
  ],
  "导入预览已过期，请重新选择文件": [
    "Import preview expired. Select files again.",
    "インポートのプレビューは期限切れです。選び直してください"
  ],
  "导入目标不能与来源相同或位于来源文件夹内部": [
    "Import destination cannot be the source or inside the source folder",
    "元と同じ場所や元フォルダーの内部にはインポートできません"
  ],
  "同名位置不是普通文件，无法覆盖：{0}": [
    "The same-name location is not a regular file and cannot be overwritten: {0}",
    "同名の場所は通常ファイルではないため上書きできません：{0}"
  ],
  "覆盖前请重新检查同名文件并确认": [
    "Check name conflicts again and confirm before overwriting",
    "上書き前に同名ファイルを再確認してください"
  ],
  "该路径已有导入任务，请等待完成后再导入": [
    "An import to this path is already running. Wait for it to finish.",
    "この場所へのインポートは実行中です。完了までお待ちください"
  ],
  "该导入已经提交，请勿重复确认": [
    "This import has already been submitted. Do not confirm again.",
    "インポートは既に開始しています。重複して確認しないでください"
  ],
  "导入任务不存在": [
    "Import task not found",
    "インポートタスクが見つかりません"
  ],
  "正在结束当前文件，请稍后恢复": [
    "Finishing the current file. Wait before resuming.",
    "現在のファイルを終了中です。再開までお待ちください"
  ],
  "来源文件已变化或不可读取，请重新选择导入": [
    "Source file changed or is unreadable. Select it again.",
    "元ファイルが変更されたか読み取れません。選び直してください"
  ],
  "同名位置不是普通文件": [
    "The same-name location is not a regular file",
    "同名の場所は通常ファイルではありません"
  ],
  "来源文件在复制期间发生变化": [
    "Source file changed during copying",
    "コピー中に元ファイルが変わりました"
  ],
  "任务已停止": [
    "Task stopped",
    "タスクを停止しました"
  ],
  "同名位置不是普通文件，无法覆盖": [
    "The same-name location is not a regular file; cannot overwrite",
    "同名の場所は通常ファイルではなく、上書きできません"
  ],
  "同名文件在确认后发生变化，已保留原文件，请重新导入": [
    "The same-name file changed after confirmation. Original kept; import again.",
    "確認後に同名ファイルが変わりました。元ファイルを保持したため、再インポートしてください"
  ],
  "同名文件过多": [
    "Too many same-name files",
    "同名ファイルが多すぎます"
  ],
  "副本已保留，部分文件索引失败，请查看扫描任务": [
    "Copies kept, but some indexing failed. Check scan tasks.",
    "コピーは保持しましたが、一部の登録に失敗しました。スキャンタスクを確認してください"
  ],
  "目录范围只适用于标签编辑": [
    "Directory scope is only supported for tag editing",
    "ディレクトリ範囲はタグ編集のみで使用できます"
  ],
  "媒体不在该目录的标签编辑范围内，请重新选择": [
    "Media is outside this directory’s tag-edit scope. Select again.",
    "メディアはこのディレクトリのタグ編集範囲外です。選び直してください"
  ],
  "请选择要处理的媒体": [
    "Select media to process",
    "処理するメディアを選択してください"
  ],
  "请选择导出目录": [
    "Choose an export directory",
    "エクスポート先を選択してください"
  ],
  "请选择媒体并填写标签名称": [
    "Select media and enter a tag name",
    "メディアを選択し、タグ名を入力してください"
  ],
  "隐藏或已删除的媒体不能直接交付": [
    "Hidden or deleted media cannot be delivered directly",
    "非表示または削除済みのメディアは直接受け渡しできません"
  ],
  "只能批量移除所有选中媒体共有的标签": [
    "Only tags shared by all selected media can be removed in bulk",
    "選択したすべてのメディアに共通するタグのみ一括削除できます"
  ],
  "此任务不支持该操作": [
    "This task does not support this action",
    "このタスクはこの操作に対応していません"
  ],
  "任务正在结束当前文件，请稍后恢复": [
    "Task is finishing the current file. Wait before resuming.",
    "現在のファイルを終了中です。再開までお待ちください"
  ],
  "此任务已由后续隐藏操作接替，无需恢复": [
    "A later visibility task has replaced this task; no resume needed",
    "後の非表示操作に引き継がれたため、再開は不要です"
  ],
  "媒体已不在图库中": [
    "Media is no longer in the library",
    "メディアはライブラリに存在しません"
  ],
  "媒体已离开该目录或移入回收站": [
    "Media left this directory or moved to the recycle bin",
    "メディアはこのディレクトリ外かごみ箱にあります"
  ],
  "媒体已隐藏或移入回收站": [
    "Media is hidden or in the recycle bin",
    "メディアは非表示かごみ箱にあります"
  ],
  "文件在排队期间已变化，未处理，请重新选择": [
    "File changed while queued and was not processed. Select again.",
    "待機中にファイルが変わったため処理していません。選び直してください"
  ],
  "拟保留的原文件已变化，未删除本组副本": [
    "A file to keep changed; no copies in this group were deleted",
    "保持予定の元ファイルが変わったため、このグループは削除していません"
  ],
  "拟保留的文件内容已变化，未删除本组副本": [
    "Contents of a file to keep changed; no copies in this group were deleted",
    "保持予定ファイルの内容が変わったため、このグループは削除していません"
  ],
  "后台文件操作未配置": [
    "Background file operations are not configured",
    "バックグラウンドのファイル操作が設定されていません"
  ],
  "文件已变化，请重新扫描后重试": [
    "File changed. Rescan and try again.",
    "ファイルが変わりました。再スキャンして再試行してください"
  ],
  "文件正在修改，请稍后重试": [
    "File is being modified. Try again shortly.",
    "ファイルは変更中です。しばらくしてから再試行してください"
  ],
  "媒体状态已变化，请刷新后重试": [
    "Media state changed. Refresh and try again.",
    "メディアの状態が変わりました。更新して再試行してください"
  ],
  "照片在处理中已变化，请刷新后重试": [
    "Photo changed during processing. Refresh and try again.",
    "処理中に写真が変わりました。更新して再試行してください"
  ],
  "该格式暂不支持安全移除 GPS，未导出原件；可关闭清除 GPS 后重试": [
    "Safe GPS removal is not supported for this format. Original not exported; retry with GPS removal off.",
    "この形式は安全なGPS除去に対応していません。元ファイルは出力していません。GPS除去をオフにして再試行できます"
  ],
  "该整理批次不存在或已经撤销": [
    "This organization batch is missing or already undone",
    "この整理バッチは存在しないか取り消し済みです"
  ],
  "隐藏操作未配置": [
    "Hidden-file operations are not configured",
    "非表示のファイル操作が設定されていません"
  ],
  "智能相册不存在": [
    "Smart album not found",
    "スマートアルバムが見つかりません"
  ],
  "标签不存在": [
    "Tag not found",
    "タグが見つかりません"
  ],
  "别名与其他标签或别名重复": [
    "Alias conflicts with another tag or alias",
    "別名が他のタグ名や別名と重複しています"
  ],
  "目录标签的层级由目录规则管理，请在目录设置中修改": [
    "Directory tag hierarchy is managed by rules. Change it in directory settings.",
    "ディレクトリタグの階層はルールで管理します。ディレクトリ設定で変更してください"
  ],
  "媒体不存在": [
    "Media not found",
    "メディアが見つかりません"
  ],
  "媒体已隐藏、停用或删除，请刷新后重试": [
    "Media is hidden, disabled or deleted. Refresh and try again.",
    "メディアは非表示、無効または削除済みです。更新して再試行してください"
  ],
  "非文件": [
    "Not a file",
    "ファイルではありません"
  ],
  "无法读取“{0}”，请确认原文件和所在目录可用": [
    "Unable to read “{0}”. Check that the original and its directory are available.",
    "「{0}」を読み取れません。元ファイルとディレクトリを確認してください"
  ],
  "无法生成照片预览": [
    "Unable to generate photo preview",
    "写真のプレビューを生成できません"
  ],
  "媒体已移除或更新，未生成过期预览": [
    "Media removed or updated; stale preview not generated",
    "メディアが削除・更新されたため、古いプレビューは生成しません"
  ],
  "媒体已移除或更新，未读取过期预览": [
    "Media removed or updated; stale preview not read",
    "メディアが削除・更新されたため、古いプレビューは読み込みません"
  ],
  "媒体已移除或更新，未保留过期预览": [
    "Media removed or updated; stale preview not kept",
    "メディアが削除・更新されたため、古いプレビューは保持しません"
  ],
  "视频缓存目录不可用": [
    "Video cache directory unavailable",
    "動画キャッシュの場所を利用できません"
  ],
  "删除计划已变化，请重新预览": [
    "Deletion plan changed. Preview again.",
    "削除の計画が変わりました。再確認してください"
  ],
  "旧扫描任务没有目录信息，请在图库目录点击“重新扫描”": [
    "Old scan has no directory information. Use “Rescan” in library directories.",
    "古いスキャンにディレクトリ情報がありません。ディレクトリ画面で再スキャンしてください"
  ],
  "图库目录已移除，不能恢复旧扫描任务；请在目录管理中重新添加": [
    "Directory removed; old scan cannot resume. Add the directory again.",
    "ディレクトリが削除済みで再開できません。ディレクトリを再追加してください"
  ],
  "图库目录已停用，请先启用目录再恢复扫描": [
    "Library directory disabled. Enable it before resuming the scan.",
    "ディレクトリが無効です。有効にしてからスキャンを再開してください"
  ],
  "文件已改变，请重新扫描后再删除": [
    "File changed. Rescan before deleting.",
    "ファイルが変わりました。再スキャンしてから削除してください"
  ],
  "回收区存在冲突，已保留两个文件": [
    "Recycle area conflict; both files kept",
    "ごみ箱の領域で競合したため、両方のファイルを保持しました"
  ],
  "原文件或所在目录不可用，未删除组织信息": [
    "Original file or directory unavailable; organization metadata kept",
    "元ファイルやディレクトリを利用できません。整理情報は保持しました"
  ],
  "回收站条目不存在": [
    "Recycle bin entry not found",
    "ごみ箱の項目が見つかりません"
  ],
  "原位置已有同名文件，未覆盖；请选择其他还原目录": [
    "A same-name file exists at the original location. Not overwritten; choose another restore directory.",
    "元の場所に同名ファイルがあります。上書きせず保持したため、別の復元先を選択してください"
  ],
  "回收区文件已变化，请检查后重试": [
    "Recycled file changed. Check and try again.",
    "ごみ箱内のファイルが変わりました。確認して再試行してください"
  ],
  "还原位置不在启用的图库目录内，请先添加/启用目录或重指定位置": [
    "Restore location is outside enabled libraries. Add/enable the directory or choose another location.",
    "復元先は有効なライブラリの外です。ディレクトリを追加・有効化するか、別の場所を選択してください"
  ],
  "还原位置的文件类型已变化，请检查后重试": [
    "File type at restore location changed. Check and retry.",
    "復元先の種類が変わりました。確認して再試行してください"
  ],
  "回收站条目正在移动或还原，请稍后重试": [
    "Recycle item is moving or restoring. Try again shortly.",
    "ごみ箱の項目は移動・復元中です。しばらくしてから再試行してください"
  ],
  "文件类型已变化，未删除；请重新扫描后检查": [
    "File type changed; not deleted. Rescan and check.",
    "ファイルの種類が変わったため削除していません。再スキャンして確認してください"
  ],
  "回收区文件内容已变化，已保留文件和记录": [
    "Recycled file contents changed; file and record kept",
    "ごみ箱のファイル内容が変わったため、ファイルと記録を保持しました"
  ],
  "文件在检查过程中变化，已保留文件": [
    "File changed during verification; kept",
    "確認中にファイルが変わったため、保持しました"
  ],
  "系统回收站不可用，原文件已保留": [
    "System Recycle Bin unavailable; original kept",
    "システムのごみ箱を利用できないため、元ファイルを保持しました"
  ],
  "任务已停止，未生成缩略图": [
    "Task stopped; thumbnail not generated",
    "タスクが停止したため、サムネイルを生成していません"
  ],
  "媒体已移除或更新，未保留过期缩略图": [
    "Media removed or updated; stale thumbnail not kept",
    "メディアが削除・更新されたため、古いサムネイルは保持しません"
  ],
  "图库目录已停用，请先启用目录再扫描": [
    "Library directory disabled. Enable it before scanning.",
    "ディレクトリが無効です。有効にしてからスキャンしてください"
  ],
  "请先还原回收站中的媒体": [
    "Restore the media from the recycle bin first",
    "先にごみ箱からメディアを復元してください"
  ],
  "缩略图缓存目录未设置": [
    "Thumbnail cache directory not configured",
    "サムネイルの保存先が未設定です"
  ],
  "媒体已移除或更新，请刷新后重试": [
    "Media removed or updated. Refresh and retry.",
    "メディアは削除・更新されています。更新して再試行してください"
  ],
  "标签名称已存在": [
    "A tag with this name already exists",
    "同じ名前のタグが既に存在します"
  ],
  "请选择要删除的父标签引用": [
    "Select the parent reference to delete",
    "削除する親タグの参照を選択してください"
  ],
  "旧任务缺少媒体明细，无法恢复": [
    "Old task lacks media details and cannot resume",
    "古いタスクにメディアの詳細がなく再開できません"
  ],
  "照片无法生成视觉特征": [
    "Unable to generate visual features for this photo",
    "写真の視覚的特徴を生成できません"
  ],
  "已有缓存清理正在执行，请等待完成": [
    "Cache cleanup is already running. Wait for completion.",
    "キャッシュの整理は既に実行中です。完了までお待ちください"
  ],
  "清理预览已过期，请重新计算": [
    "Cleanup preview expired. Calculate again.",
    "整理のプレビューは期限切れです。再計算してください"
  ],
  "任务正在停止，请稍后再试": [
    "Task is stopping. Try again shortly.",
    "タスクを停止中です。しばらくしてから再試行してください"
  ],
  "缓存目录不可用": [
    "Cache directory unavailable",
    "キャッシュの場所を利用できません"
  ],
  "缓存已重新使用，已保留": [
    "Cache is in use again; kept",
    "キャッシュは再使用中のため保持しました"
  ],
  "缓存路径无效，已跳过": [
    "Invalid cache path; skipped",
    "キャッシュのパスが無効なためスキップしました"
  ],
  "缓存已不存在，已跳过": [
    "Cache no longer exists; skipped",
    "キャッシュは存在しないためスキップしました"
  ],
  "此路径是媒体原文件，已保留": [
    "This path is an original media file; kept",
    "このパスは元のメディアのため保持しました"
  ],
  "缓存路径已变化，已跳过": [
    "Cache path changed; skipped",
    "キャッシュのパスが変わったためスキップしました"
  ],
  "缓存已更新，已跳过；可重新计算后清理": [
    "Cache updated; skipped. Recalculate before cleanup.",
    "キャッシュは更新済みのためスキップしました。再計算してから消去してください"
  ],
  "缓存正在生成，已跳过": [
    "Cache is being generated; skipped",
    "キャッシュは生成中のためスキップしました"
  ],
  "任务已取消": [
    "Task cancelled",
    "タスクをキャンセルしました"
  ],
  "无法识别视频画面": [
    "Unable to recognize video frames",
    "動画のフレームを認識できません"
  ],
  "视频未能输出可用画面，无法生成缩略图；请检查视频是否完整或可播放": [
    "Video produced no usable frames; no thumbnail generated. Check that the video is complete and playable.",
    "動画から表示可能なフレームを取得できず、サムネイルを生成できません。動画が完全で再生可能か確認してください"
  ],
  "媒体已移除或更新，未生成过期缩略图": [
    "Media removed or updated; stale thumbnail not generated",
    "メディアが削除・更新されたため、古いサムネイルは生成しません"
  ],
  "此媒体不是照片，无法生成照片缩略图": [
    "This media is not a photo; cannot generate a photo thumbnail",
    "写真ではないため、写真のサムネイルは生成できません"
  ],
  "此媒体不是视频，无法生成视频缩略图": [
    "This media is not a video; cannot generate a video thumbnail",
    "動画ではないため、動画のサムネイルは生成できません"
  ],
  "同步 Windows 隐藏属性已停止": [
    "Windows hidden attribute sync stopped",
    "Windowsの隠し属性の同期を停止しました"
  ],
  "当前系统不支持同步 Windows 隐藏属性": [
    "This system does not support Windows hidden attribute sync",
    "このシステムではWindowsの隠し属性を同期できません"
  ],
  "同步 Windows 隐藏属性服务中断，请重试": [
    "Windows hidden attribute service interrupted. Try again.",
    "Windowsの隠し属性の同期サービスが中断されました。再試行してください"
  ],
  "同步 Windows 隐藏属性失败：{0}": [
    "Windows hidden attribute sync failed: {0}",
    "Windowsの隠し属性の同期に失敗しました：{0}"
  ],
  "同步 Windows 隐藏属性超时，请重试": [
    "Windows hidden attribute sync timed out. Try again.",
    "Windowsの隠し属性の同期がタイムアウトしました。再試行してください"
  ],
  "相册不存在": [
    "Album not found",
    "アルバムが見つかりません"
  ],
  "目录相册的层级由原目录管理": [
    "Directory album hierarchy follows the source directory",
    "ディレクトリアルバムの階層は元のディレクトリに従います"
  ],
  "请选择有效的相册文件夹或普通相册": [
    "Choose a valid album folder or regular album",
    "有効なアルバムフォルダーか通常アルバムを選択してください"
  ],
  "不能将相册移动到自身或子相册中": [
    "An album cannot be moved under itself or a subalbum",
    "アルバム自身や子アルバムの下には移動できません"
  ],
  "相册层级最多支持 5 级": [
    "Albums support up to 5 levels",
    "アルバムは最大5階層までです"
  ],
  "相册文件夹不存在": [
    "Album folder not found",
    "アルバムフォルダーが見つかりません"
  ],
  "该移出操作已撤销或记录已过期": [
    "Removal already undone or its record expired",
    "移出操作は取り消し済みか記録の期限が切れています"
  ],
  "相册已删除，无法撤销": [
    "Album deleted; cannot undo",
    "アルバムは削除済みのため取り消せません"
  ],
  "智能相册已改变，无法撤销": [
    "Smart album changed; cannot undo",
    "スマートアルバムが変更されたため取り消せません"
  ],
  "子目录必须位于所选目录内": [
    "Subdirectories must be inside the selected directory",
    "子ディレクトリは選択したディレクトリ内にある必要があります"
  ],
  "图库目录不存在": [
    "Library directory not found",
    "ライブラリのディレクトリが見つかりません"
  ],
  "父子目录不能使用同一个标签": [
    "Parent and child directories cannot use the same tag",
    "親と子のディレクトリに同じタグは使用できません"
  ],
  "智能相册至少需要一个标签": [
    "A smart album requires at least one tag",
    "スマートアルバムにはタグが1つ以上必要です"
  ],
  "相同标签不能同时包含和排除": [
    "A tag cannot be both included and excluded",
    "同じタグを含む条件と除外条件に同時に指定できません"
  ],
  "规则中的标签已删除，请重新选择": [
    "A rule tag was deleted. Select again.",
    "ルール内のタグは削除済みです。選び直してください"
  ],
  "匹配结果已变化，请重新计算变更预览": [
    "Matching results changed. Recalculate the preview.",
    "一致する結果が変わりました。変更のプレビューを再計算してください"
  ],
  "相册名称已存在": [
    "An album with this name already exists",
    "同じ名前のアルバムが既に存在します"
  ],
  "该相册不是智能相册": [
    "This is not a smart album",
    "このアルバムはスマートアルバムではありません"
  ],
  "智能相册需要编辑标签规则": [
    "Edit tag rules for smart albums",
    "スマートアルバムはタグのルールを編集してください"
  ],
  "请使用编辑文件夹": [
    "Use Edit folder instead",
    "「フォルダーを編集」を使用してください"
  ],
  "绑定标签已删除，请重新选择": [
    "A linked tag was deleted. Select again.",
    "関連タグは削除済みです。選び直してください"
  ],
  "相册标签只能使用普通标签，目录标签请在目录设置中管理": [
    "Album tags must be regular tags. Manage directory tags in directory settings.",
    "アルバムには通常タグのみを使用できます。ディレクトリタグはディレクトリ設定で管理してください"
  ],
  "封面已不在相册内，请重新选择": [
    "Cover is no longer in the album. Select again.",
    "カバーはアルバム内にありません。選び直してください"
  ],
  "请选择两个不同的标签": [
    "Choose two different tags",
    "異なるタグを2つ選択してください"
  ],
  "不能将父标签合并到其子标签": [
    "Cannot merge a parent tag into its descendant",
    "親タグを子孫タグに統合できません"
  ],
  "目录标签请先解除目录规则再合并": [
    "Remove directory rules from directory tags before merging",
    "ディレクトリタグを統合する前にルールを解除してください"
  ],
  "影响范围已变化，请重新预览": [
    "Affected scope changed. Preview again.",
    "影響範囲が変わりました。再確認してください"
  ],
  "合并会产生包含/排除冲突，请先修改智能相册规则": [
    "Merging would conflict with include/exclude rules. Edit smart album rules first.",
    "統合すると含む条件と除外条件が競合します。先にスマートアルバムのルールを変更してください"
  ],
  "相册不存在，请刷新后重试": [
    "Album not found. Refresh and retry.",
    "アルバムが見つかりません。更新して再試行してください"
  ],
  "请输入 1–200 个字符的相册名称": [
    "Enter an album name of 1–200 characters",
    "アルバム名を1〜200文字で入力してください"
  ],
  "文件夹用于组织相册，请选择普通相册加入媒体": [
    "Folders organize albums. Choose a regular album to add media.",
    "フォルダーはアルバム整理用です。メディアの追加先は通常アルバムを選択してください"
  ],
  "智能相册由标签规则自动整理，不能手动加入": [
    "Smart albums use tag rules; media cannot be added manually",
    "スマートアルバムはタグのルールで整理するため手動追加できません"
  ],
  "请从当前相册内选择可见的媒体作为封面": [
    "Choose visible media from this album for the cover",
    "このアルバム内の表示可能なメディアをカバーに選択してください"
  ],
  "多个标签使用了该英文名或别名，请选择具体标签": [
    "Multiple tags share this English name or alias. Choose a specific tag.",
    "この英語名や別名を複数のタグが使用しています。具体的なタグを選択してください"
  ],
  "该名称已用于目录标签，请使用其他普通标签名称": [
    "This name is used by a directory tag. Choose another regular tag name.",
    "ディレクトリタグがこの名前を使用しています。別の通常タグ名を使用してください"
  ],
  "该标签用于目录规则，请先在目录设置中移除规则": [
    "This tag is used by directory rules. Remove the rules first.",
    "このタグはディレクトリのルールで使用中です。先にルールを解除してください"
  ],
  "子标签用于目录规则，请先解除目录规则": [
    "A child tag is used by directory rules. Remove the rules first.",
    "子タグがディレクトリのルールで使用中です。先にルールを解除してください"
  ],
  "请输入 1–100 个字符的标签名称": [
    "Enter a tag name of 1–100 characters",
    "タグ名を1〜100文字で入力してください"
  ],
  "标签不存在，请刷新后重试": [
    "Tag not found. Refresh and retry.",
    "タグが見つかりません。更新して再試行してください"
  ],
  "该名称已是其他标签的别名": [
    "This name is already another tag’s alias",
    "この名前は他のタグの別名として使用されています"
  ],
  "该标签由目录规则提供，请在目录设置中修改": [
    "This tag comes from directory rules. Change it in directory settings.",
    "このタグはディレクトリのルールで付与されています。ディレクトリ設定で変更してください"
  ],
  "该父标签由子标签自动包含，请先移除对应子标签": [
    "This ancestor tag is included by a child tag. Remove the child tag first.",
    "この親タグは子タグにより自動付与されています。先に対応する子タグを外してください"
  ],
  "顶级标签没有可删除的额外引用": [
    "Top-level tag has no extra reference to delete",
    "最上位タグに削除できる追加参照はありません"
  ],
  "该引用由目录规则管理，请在目录设置中修改": [
    "This reference is managed by directory rules. Change it in directory settings.",
    "この参照はディレクトリのルールで管理されています。ディレクトリ設定で変更してください"
  ],
  "标签引用已不存在": [
    "Tag reference no longer exists",
    "タグの参照は存在しません"
  ],
  "标签引用已变化，请刷新后重试": [
    "Tag references changed. Refresh and retry.",
    "タグの参照が変わりました。更新して再試行してください"
  ],
  "不能把标签移到自己或子标签下": [
    "Cannot move a tag under itself or its descendants",
    "タグ自身や子孫タグの下には移動できません"
  ],
  "父标签不存在": [
    "Parent tag not found",
    "親タグが見つかりません"
  ],
  "标签层级最多为 5 级": [
    "Tags support up to 5 levels",
    "タグは最大5階層までです"
  ],
  "请选择需要拖出的媒体": [
    "Choose media to drag out",
    "ドラッグするメディアを選択してください"
  ],
  "拖出媒体参数无效，一次最多选择10000项": [
    "Invalid drag parameters; select at most 10,000 items",
    "ドラッグの指定が無効です。最大10,000項目まで選択できます"
  ],
  "正在准备拖出，请稍后再试": [
    "Preparing drag. Try again shortly.",
    "ドラッグを準備中です。しばらくしてから再試行してください"
  ],
  "部分媒体已不可用，请刷新后重试": [
    "Some media are unavailable. Refresh and retry.",
    "一部のメディアを利用できません。更新して再試行してください"
  ],
  "测试数据目录必须是绝对路径": [
    "Test data directory must be absolute",
    "テスト用データの場所は絶対パスで指定してください"
  ],
  "无效的导入方式": [
    "Invalid import method",
    "インポートの方法が無効です"
  ],
  "剪贴板图片超过32MB，请保存为文件后导入": [
    "Clipboard image exceeds 32 MB. Save it as a file before importing.",
    "クリップボード画像が32 MBを超えています。ファイルに保存してから取り込んでください"
  ],
  "无效的窗口状态": [
    "Invalid window state",
    "ウィンドウの状態が無効です"
  ],
  "无效的窗口颜色": [
    "Invalid window color",
    "ウィンドウの色が無効です"
  ],
  "显示器已断开，请重新选择": [
    "Display disconnected. Choose another display.",
    "モニターが切断されました。選び直してください"
  ],
  "请选择 64 MB 以内的背景音乐": [
    "Choose background music smaller than 64 MB",
    "64 MB以下のBGMを選択してください"
  ],
  "不支持的音乐格式": [
    "Unsupported music format",
    "対応していない音楽形式です"
  ],
  "字幕文件过大，请选择 8 MB 以内的文本字幕": [
    "Subtitle file too large. Choose a text subtitle under 8 MB.",
    "字幕が大きすぎます。8 MB以下のテキスト字幕を選択してください"
  ],
  "导出目录不可用": [
    "Export directory unavailable",
    "エクスポート先を利用できません"
  ],
  "媒体参数无效": [
    "Invalid media parameters",
    "メディアの指定が無効です"
  ],
  "不支持的操作": [
    "Unsupported operation",
    "対応していない操作です"
  ],
  "无法从此窗口拖出媒体": [
    "Cannot drag media from this window",
    "このウィンドウからメディアをドラッグできません"
  ],
  "拖出窗口已关闭": [
    "Drag source window closed",
    "ドラッグ元のウィンドウが閉じられました"
  ],
  "缩略图正在更新，请稍后重试": [
    "Thumbnail is updating. Try again shortly.",
    "サムネイルを更新中です。しばらくしてから再試行してください"
  ],
  "读取剪贴板超时，请重试": [
    "Clipboard read timed out. Retry.",
    "クリップボードの読み込みがタイムアウトしました。再試行してください"
  ],
  "剪贴板暂时不可读取，请重试": [
    "Clipboard temporarily unavailable. Retry.",
    "クリップボードを一時的に読み取れません。再試行してください"
  ],
  "剪贴板文件列表无效": [
    "Invalid clipboard file list",
    "クリップボードのファイル一覧が無効です"
  ],
  "原文件剪贴板当前仅支持 Windows": [
    "Copying original files to the clipboard is supported only on Windows",
    "元ファイルのクリップボードへのコピーはWindowsのみ対応しています"
  ],
  "系统剪贴板暂时没有响应，请稍后重试": [
    "System clipboard is not responding. Try again shortly.",
    "システムのクリップボードが応答しません。しばらくしてから再試行してください"
  ]
};
