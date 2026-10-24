#!/usr/bin/env bash
# upgrade-csb.sh — CSB 套件通用升级脚本（v1.0 · 2026-10-24 · 若兰 🌸）
#
# 设计原则：
#   1. 默认只做「快进合并」（--ff-only）。分叉/本地提交 → 跳过并报告，绝不 reset。
#   2. 每个仓升级前打 git bundle 全量备份，回滚只需一条命令。
#   3. 有未提交的已跟踪改动 → 默认跳过（--stash 才暂存）。
#   4. 幂等：重复跑无副作用。不联网时失败但不破坏现场。
#   5. 先 --check 再真跑：批量升级前先看谁落后。
#
# 用法：
#   bash upgrade-csb.sh --check            # 只看：版本 / 落后多少 / 有无本地改动
#   bash upgrade-csb.sh                    # 升级（快进合并 + 按需装依赖）
#   bash upgrade-csb.sh --stash --test     # 暂存本地改动 + 跑测试
#   bash upgrade-csb.sh --rollback DIR     # 用备份回滚
#
# 选项：
#   --base DIR       仓库根目录（默认自动探测：./ 或 ~/.openclaw/workspace）
#   --repos "a b"    只处理这些仓（默认全套 9 仓）
#   --check          只检查，不改动
#   --stash          升级前 git stash（成功后再 pop）
#   --rebase         允许 rebase 分叉（默认跳过）
#   --test           升级后跑 npm test（有该脚本才跑）
#   --deps           强制装依赖（默认仅 package*.json 变化时）
#   --no-deps        完全不装依赖
#   --backup-dir DIR 备份目录（默认 <base>/.csb-upgrade-backups）
#   --remote NAME    只用指定远程（默认 origin 优先，失败自动换镜像）
#   --rollback DIR   回滚：把 DIR 里的 bundle 恢复到对应仓
#   -h | --help      帮助
#
# 退出码：0 = 全部成功或无变化 / 1 = 有仓失败（其余继续执行）/ 2 = 参数错误

set -uo pipefail

DEFAULT_REPOS="csb-a2a-aip csb-aep csb-memory csb-charter csb-awakening-standard csb-security csb-metacognition csb-compliance-degree csb-starter-kit"

BASE=""
REPOS="$DEFAULT_REPOS"
CHECK_ONLY=0
DO_STASH=0
DO_REBASE=0
DO_TEST=0
DEPS_MODE="auto"        # auto | force | none
BACKUP_ROOT=""
ROLLBACK_DIR=""
FORCE_REMOTE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --repos) REPOS="${2:-}"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    --stash) DO_STASH=1; shift ;;
    --rebase) DO_REBASE=1; shift ;;
    --test) DO_TEST=1; shift ;;
    --deps) DEPS_MODE="force"; shift ;;
    --no-deps) DEPS_MODE="none"; shift ;;
    --backup-dir) BACKUP_ROOT="${2:-}"; shift 2 ;;
    --remote) FORCE_REMOTE="${2:-}"; shift 2 ;;
    --rollback) ROLLBACK_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1（--help 看用法）" >&2; exit 2 ;;
  esac
done

# ---------- 输出 ----------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_0=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_B=''; C_0=''
fi
ok()   { printf '%s✅%s %s\n' "$C_OK" "$C_0" "$*"; }
warn() { printf '%s⚠️ %s%s\n' "$C_WARN" "$*" "$C_0"; }
err()  { printf '%s❌ %s%s\n' "$C_ERR" "$*" "$C_0"; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_0"; }

# ---------- 回滚模式 ----------
if [ -n "$ROLLBACK_DIR" ]; then
  [ -d "$ROLLBACK_DIR" ] || { err "备份目录不存在: $ROLLBACK_DIR"; exit 2; }
  echo "${C_B}♻️  回滚自 $ROLLBACK_DIR${C_0}"
  rc=0
  for b in "$ROLLBACK_DIR"/*.bundle; do
    [ -e "$b" ] || continue
    name="$(basename "$b" .bundle)"
    repo="$name"
    dir="$(find "${BASE:-$HOME}" -maxdepth 3 -type d -name "$repo" -print 2>/dev/null | head -1)"
    if [ -z "$dir" ] || [ ! -d "$dir/.git" ]; then
      warn "$repo: 找不到仓库，跳过（可手动 git clone $b）"
      rc=1; continue
    fi
    pre="$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo '?')"
    br="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
    # unbundle 把对象灌回仓库，再用备份里的 head 硬重置（不依赖远程可达）
    info="$(git -C "$dir" bundle unbundle "$b" 2>/dev/null)"
    line="$(printf '%s\n' "$info" | grep "refs/heads/$br\$" | head -1)"
    [ -z "$line" ] && line="$(printf '%s\n' "$info" | grep 'refs/heads/' | head -1)"
    sha="$(printf '%s\n' "$line" | awk '{print $1}')"
    if [ -z "$sha" ]; then
      err "$repo: 备份里没有可用分支，回滚失败"
      rc=1; continue
    fi
    if git -C "$dir" reset --hard "$sha" >/dev/null 2>&1; then
      ok "$repo: $pre → $(git -C "$dir" rev-parse --short HEAD)"
    else
      err "$repo 回滚失败"; rc=1
    fi
  done
  exit $rc
fi

# ---------- 定位根目录 ----------
if [ -z "$BASE" ]; then
  if [ -d "./csb-a2a-aip/.git" ]; then
    BASE="$(pwd)"
  elif [ -d "$HOME/.openclaw/workspace/csb-a2a-aip/.git" ]; then
    BASE="$HOME/.openclaw/workspace"
  else
    BASE="$(find "$HOME" -maxdepth 4 -type d -name csb-a2a-aip 2>/dev/null | head -1 | xargs -r dirname)"
  fi
fi
[ -n "$BASE" ] && [ -d "$BASE" ] || { err "找不到 CSB 仓库根目录，请用 --base 指定"; exit 2; }
BACKUP_ROOT="${BACKUP_ROOT:-$BASE/.csb-upgrade-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "${C_B}════ CSB 套件升级 ════${C_0}"
dim "根目录: $BASE"
dim "模式:   $([ "$CHECK_ONLY" = 1 ] && echo '只检查(--check)' || echo '执行升级')"
[ "$CHECK_ONLY" = 0 ] && dim "备份:   $BACKUP_ROOT/$STAMP"
[ "$CHECK_ONLY" = 0 ] && mkdir -p "$BACKUP_ROOT/$STAMP"

# ---------- 版本读取 ----------
repo_version() { # $1=dir
  local d="$1" v=""
  if [ -f "$d/VERSION" ]; then v="$(head -1 "$d/VERSION" | tr -d '[:space:]')"; fi
  if [ -f "$d/package.json" ] && command -v node >/dev/null 2>&1; then
    v="$(node -e 'try{const p=require(process.argv[1]);process.stdout.write(p.version||"")}catch(e){}' "$d/package.json" 2>/dev/null)"
  fi
  echo "${v:--}"
}

# ---------- 远程选择 ----------
pick_remote() { # $1=dir
  local d="$1" r
  for r in origin github gitee gitcode cnb gogs gogs-pub; do
    if git -C "$d" remote | grep -qx "$r"; then echo "$r"; return 0; fi
  done
  git -C "$d" remote | head -1
}

# 按优先级列出可用远程（origin → 镜像），供 fetch 失败时逐个回退
remote_candidates() { # $1=dir
  local d="$1" r seen=" "
  for r in ${FORCE_REMOTE:-origin github gitee gitcode cnb gogs gogs-pub}; do
    if git -C "$d" remote | grep -qx "$r"; then echo "$r"; seen="$seen$r "; fi
  done
  for r in $(git -C "$d" remote); do
    case "$seen" in *" $r "*) ;; *) echo "$r" ;; esac
  done
}

remote_url() { git -C "$1" remote get-url "$2" 2>/dev/null || echo '?'; }

# ---------- 主循环 ----------
FAILED=0; SKIPPED=0; UPDATED=0; UNCHANGED=0
SUMMARY=""

for name in $REPOS; do
  dir="$BASE/$name"
  printf '\n%s\n' "${C_B}── $name ──${C_0}"

  if [ ! -d "$dir/.git" ]; then
    warn "未找到（$dir 不是 git 仓库）→ 跳过"
    SUMMARY+="$name|缺失|-|-|skip"$'\n'; SKIPPED=$((SKIPPED+1)); continue
  fi

  # 只读挂载检测（2026-10-24 · 若琢反馈）：容器里 csb-security 是只读挂载，
  # 升级会失败在 git fetch 那步，报「网络/凭据问题」——**是误导**。
  # 这里提前探测，明确告诉人「这不是网络问题，是挂载只读，得去宿主侧」。
  if ! ( : > "$dir/.git/.csb-write-test" ) 2>/dev/null; then
    warn "$name：.git 不可写（只读挂载）→ 无法在此环境升级"
    echo "     这不是网络问题。请在**宿主侧**更新该仓，或让宿主放开写挂载。"
    SUMMARY+="$name|-|-|-|-|readonly"$'\n'; SKIPPED=$((SKIPPED+1)); continue
  fi
  rm -f "$dir/.git/.csb-write-test" 2>/dev/null

  branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  old="$(git -C "$dir" rev-parse --short HEAD 2>/dev/null)"
  ver_old="$(repo_version "$dir")"
  remote="$(pick_remote "$dir")"
  if [ -z "$remote" ]; then
    warn "没有配置任何 git remote → 跳过（请先 git remote add origin <url>）"
    SUMMARY+="$name|$old|$ver_old|-|-|no-remote"$'\n'; SKIPPED=$((SKIPPED+1)); continue
  fi
  dim "分支 $branch · HEAD $old · 版本 $ver_old · 默认远程 $remote ($(remote_url "$dir" "$remote"))"

  # 本地已跟踪改动
  dirty="$(git -C "$dir" status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$dirty" != "0" ]; then
    if [ "$CHECK_ONLY" = 1 ]; then
      warn "有 $dirty 处未提交改动（真升级时默认跳过；加 --stash 可暂存）"
    elif [ "$DO_STASH" = 1 ]; then
      git -C "$dir" stash push -m "csb-upgrade-$STAMP" >/dev/null 2>&1 \
        && ok "已暂存 $dirty 处改动（升级后自动 pop）" || { err "stash 失败 → 跳过"; FAILED=$((FAILED+1)); continue; }
    else
      warn "有 $dirty 处未提交改动 → 跳过（先手动提交，或加 --stash）"
      git -C "$dir" status --porcelain --untracked-files=no | head -5 | sed 's/^/     /'
      SUMMARY+="$name|$old|$ver_old|-|-|dirty"$'\n'; SKIPPED=$((SKIPPED+1)); continue
    fi
  fi

  # fetch（逐个远程回退，规避单平台抖动）
  fetch_ok=0
  for cand in $(remote_candidates "$dir"); do
    if git -C "$dir" fetch --prune "$cand" >/dev/null 2>&1; then
      remote="$cand"; fetch_ok=1
      [ "$cand" != "$(pick_remote "$dir")" ] && dim "↩ 主远程不可用，改用镜像: $cand"
      break
    fi
    dim "↩ $cand 拉取失败，换下一个远程…"
  done
  if [ "$fetch_ok" = 0 ]; then
    err "所有远程都拉取失败 → 网络/凭据问题，仓库未改动"
    SUMMARY+="$name|$old|$ver_old|-|-|fetch-fail"$'\n'; FAILED=$((FAILED+1)); continue
  fi

  if ! git -C "$dir" rev-parse --verify "$remote/$branch" >/dev/null 2>&1; then
    fb=""; for b in main master; do git -C "$dir" rev-parse --verify "$remote/$b" >/dev/null 2>&1 && { fb="$b"; break; }; done
    if [ -n "$fb" ]; then warn "远程无 $branch 分支，改用 $fb"; branch="$fb"; else
      warn "远程没有分支 $branch → 跳过"; SUMMARY+="$name|$old|$ver_old|-|-|no-branch"$'\n'; SKIPPED=$((SKIPPED+1)); continue; fi
  fi

  upstream="$remote/$branch"

  behind="$(git -C "$dir" rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)"
  ahead="$(git -C "$dir" rev-list --count "$upstream..HEAD" 2>/dev/null || echo 0)"
  dim "落后 $behind 个提交 · 领先 $ahead 个提交"

  if [ "$behind" = "0" ]; then
    ok "已是最新（$old · $ver_old）"
    SUMMARY+="$name|$old|$ver_old|$old|same"$'\n'; UNCHANGED=$((UNCHANGED+1)); continue
  fi

  if [ "$CHECK_ONLY" = 1 ]; then
    warn "可升级：$behind 个提交（$old → $upstream）"
    git -C "$dir" log --oneline "HEAD..$upstream" | head -5 | sed 's/^/     /'
    SUMMARY+="$name|$old|$ver_old|$upstream|behind:$behind"$'\n'; continue
  fi

  if [ "$ahead" != "0" ] && [ "$DO_REBASE" = 0 ]; then
    err "本地有 $ahead 个提交，与远程分叉 → 跳过（不自动 rebase；可用 --rebase）"
    [ "$DO_STASH" = 1 ] && git -C "$dir" stash pop >/dev/null 2>&1
    SUMMARY+="$name|$old|$ver_old|-|-|diverged"$'\n'; FAILED=$((FAILED+1)); continue
  fi

  # 备份（git bundle 全量，可完整回滚）
  bundle="$BACKUP_ROOT/$STAMP/$name.bundle"
  if ! git -C "$dir" bundle create "$bundle" --all >/dev/null 2>&1; then
    err "备份失败 → 中止该仓（不冒险）"; FAILED=$((FAILED+1)); continue
  fi
  printf '%s %s %s\n' "$old" "$branch" "$upstream" > "$BACKUP_ROOT/$STAMP/$name.sha"
  dim "备份: $bundle ($(du -h "$bundle" | cut -f1)) · 原 HEAD $old"

  # 合并
  if [ "$ahead" != "0" ]; then
    git -C "$dir" rebase "$upstream" >/dev/null 2>&1 || { err "rebase 冲突 → 已停在现场，请手动解决（git rebase --abort 可退）"; FAILED=$((FAILED+1)); continue; }
  else
    git -C "$dir" merge --ff-only "$upstream" >/dev/null 2>&1 || { err "快进合并失败（意外），仓库未改动"; FAILED=$((FAILED+1)); continue; }
  fi
  new="$(git -C "$dir" rev-parse --short HEAD)"
  ver_new="$(repo_version "$dir")"
  ok "已更新 $old → $new （$ver_old → $ver_new）"

  # 依赖
  deps_changed=0
  git -C "$dir" diff --name-only "$old..HEAD" 2>/dev/null | grep -qE '(^|/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml)$' && deps_changed=1
  [ ! -d "$dir/node_modules" ] && [ -f "$dir/package.json" ] && deps_changed=1
  if [ "$DEPS_MODE" != "none" ] && [ -f "$dir/package.json" ] && { [ "$DEPS_MODE" = "force" ] || [ "$deps_changed" = 1 ]; }; then
    if command -v npm >/dev/null 2>&1; then
      dim "安装依赖…"
      if [ -f "$dir/package-lock.json" ]; then npm ci --prefix "$dir" >/dev/null 2>&1 || npm install --prefix "$dir" >/dev/null 2>&1
      else npm install --prefix "$dir" >/dev/null 2>&1; fi
      [ $? = 0 ] && ok "依赖已更新" || warn "依赖安装失败（不影响代码已更新，请手动 npm install）"
    else
      warn "未安装 npm，跳过依赖"
    fi
  fi

  # 测试
  if [ "$DO_TEST" = 1 ] && [ -f "$dir/package.json" ] && command -v node >/dev/null 2>&1; then
    if node -e 'const s=require(process.argv[1]).scripts||{};process.exit(s.test?0:1)' "$dir/package.json" 2>/dev/null; then
      dim "跑测试…"
      if (cd "$dir" && npm test --silent >/dev/null 2>&1); then ok "测试通过"; else warn "测试失败（代码已更新，请查看 npm test 输出）"; fi
    else
      dim "该仓无 npm test 脚本"
    fi
  fi

  # 恢复 stash
  if [ "$DO_STASH" = 1 ] && [ "$dirty" != "0" ]; then
    if git -C "$dir" stash pop >/dev/null 2>&1; then ok "本地改动已恢复";
    else warn "stash pop 冲突：改动仍在 stash（git stash list 可见，stash@{0}），请手动解决后可选 git stash drop"; fi
  fi

  SUMMARY+="$name|$old|$ver_old|$new|updated"$'\n'; UPDATED=$((UPDATED+1))
done

# ---------- 汇总 ----------
echo
echo "${C_B}════ 汇总 ════${C_0}"
printf '%-26s %-9s %-10s %-9s %s\n' "仓库" "原" "版本" "新" "状态"
echo "$SUMMARY" | while IFS='|' read -r n a b c st; do
  [ -z "${n:-}" ] && continue
  mark=""
  case "$st" in
    updated)    mark="${C_OK}已更新${C_0}" ;;
    same)       mark="最新" ;;
    dirty)      mark="${C_WARN}跳过·有改动${C_0}" ;;
    diverged)   mark="${C_ERR}跳过·分叉${C_0}" ;;
    fetch-fail) mark="${C_ERR}失败·网络${C_0}" ;;
    no-remote)  mark="${C_WARN}跳过·无远程${C_0}" ;;
    missing)    mark="${C_DIM}未安装${C_0}" ;;
    skip)       mark="${C_DIM}跳过${C_0}" ;;
    readonly)   mark="${C_WARN}跳过·只读挂载${C_0}" ;;
    behind:*)   mark="${C_WARN}${st}${C_0}" ;;
    *)          mark="$st" ;;
  esac
  printf '%-26s %-9s %-10s %-9s %s\n' "$n" "${a:--}" "${b:--}" "${c:--}" "$mark"
done

echo
if [ "$CHECK_ONLY" = 1 ]; then
  dim "只检查模式，未改动任何文件。确认后执行：bash $0 $([ "$BASE" != "$(pwd)" ] && echo "--base $BASE ")"
else
  echo "更新 $UPDATED · 最新 $UNCHANGED · 跳过 $SKIPPED · 失败 $FAILED"
  [ "$FAILED" = 0 ] || warn "有失败项，见上；回滚：bash $0 --rollback $BACKUP_ROOT/$STAMP"
fi

# ---------- 关键提醒（fail-closed 变更） ----------
# ---------- 版本一致性体检（2026-10-24 新增） ----------
# 起因：若琢升级后报出 2 处版本漂移 + 1 处硬编码。漂移不是"升错了"，
# 是**版本号被抄了两份，改一份忘一份** —— 这类问题必须机械核对，不能靠人眼。
CV="$(dirname "$0")/check-versions.js"
if [ -f "$CV" ] && command -v node >/dev/null 2>&1; then
  echo
  if [ "$CHECK_ONLY" = 1 ]; then
    node "$CV" --base "$BASE" 2>&1 | sed 's/^/  /'
  elif ! node "$CV" --base "$BASE" >/dev/null 2>&1; then
    warn "版本一致性体检发现问题（不影响本次升级，但建议修）："
    node "$CV" --base "$BASE" 2>&1 | grep -E "^❌|\[C[123]\]" | sed 's/^/  /'
  else
    ok "版本一致性体检通过"
  fi
fi

if [ "$CHECK_ONLY" = 0 ] && echo "$REPOS" | grep -qw csb-a2a-aip && [ -d "$BASE/csb-a2a-aip/.git" ]; then
  a2a_ver="$(repo_version "$BASE/csb-a2a-aip")"
  case "$a2a_ver" in
    5.[1-9]*|6.*)
      have_secret=0
      for f in "$BASE/csb-a2a-aip/.env" "$HOME/.openclaw/.env" "./.env"; do
        [ -f "$f" ] && grep -q '^[[:space:]]*A2A_SHARED_SECRET=.\{16,\}' "$f" 2>/dev/null && have_secret=1
      done
      echo
      if [ "$have_secret" = 1 ]; then
        ok "A2A $a2a_ver：检测到 A2A_SHARED_SECRET（≥16 字符），重启后会打印密钥指纹"
      else
        warn "A2A $a2a_ver 是 fail-closed 版本：没有 A2A_SHARED_SECRET 时【远程命令模块拒绝启动】"
        echo "     （A2A 本体、消息收发、论坛、注册表不受影响，服务照常起来；日志会有一条 ⚠️ 远程命令不可用）"
        echo "     用远程命令：在 .env 加 A2A_SHARED_SECRET=<64 位 hex>（与对端同值），再重启"
        echo "     仅本地调试：A2A_ALLOW_INSECURE_SIGNER=1（进程内随机密钥，只与自己互通）"
      fi
      ;;
  esac
fi

echo
dim "提示：重启各服务后生效（A2A: ./start.sh 或 keepalive 脚本；AEP: 重启 server/index.js）"
exit $([ "$FAILED" = 0 ] && echo 0 || echo 1)
