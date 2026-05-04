'use client';

/**
 * FileCard — glassmorphic file tile with type-aware previews and full CRUD UI.
 *
 * Sender mode gets a 3-dot kebab menu in the top-right of the preview area
 * with two actions:
 *   - Rename: swaps the filename text for an inline input. Enter saves,
 *             Escape cancels. Auto-selects the part before the extension.
 *   - Delete: opens a two-step confirmation inside the dropdown — first
 *             click reveals a red "Yes, delete" button.
 *
 * The component is presentational: rename/delete network calls live in the
 * parent. We invoke `onRename(id, newName)` / `onDelete(id)` and let the
 * parent handle optimistic state updates, error recovery, and revert.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Loader2,
  MoreVertical,
  Music,
  Pencil,
  Trash2,
  Video as VideoIcon,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileCardData {
  id?: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  blobUrl?: string;
}

interface FileCardProps {
  file: FileCardData;
  mode: 'sender' | 'receiver';
  /**
   * Called when the user submits a rename. Should resolve once the rename is
   * persisted (or rejected). Throwing/rejecting will revert the optimistic
   * update in the parent.
   */
  onRename?: (id: string, newName: string) => Promise<void> | void;
  /**
   * Called when the user confirms a delete. Same async contract as onRename.
   */
  onDelete?: (id: string) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// File-type categorisation
// ---------------------------------------------------------------------------

type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'archive'
  | 'document'
  | 'other';

const EXT_MAP: Record<string, FileCategory> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
  webp: 'image', svg: 'image', bmp: 'image', heic: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', avi: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio',
  pdf: 'pdf',
  txt: 'text', md: 'text', json: 'text', xml: 'text', csv: 'text',
  log: 'text', yml: 'text', yaml: 'text', html: 'text', css: 'text', js: 'text', ts: 'text',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  ppt: 'document', pptx: 'document', odt: 'document', ods: 'document',
};

function getFileCategory(mimeType: string, fileName: string): FileCategory {
  const mt = mimeType.toLowerCase();
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  if (mt === 'application/pdf') return 'pdf';
  if (
    mt.startsWith('text/') ||
    mt === 'application/json' ||
    mt === 'application/xml' ||
    mt === 'application/javascript'
  ) {
    return 'text';
  }
  if (
    mt === 'application/zip' ||
    mt === 'application/x-rar-compressed' ||
    mt === 'application/x-7z-compressed' ||
    mt === 'application/x-tar' ||
    mt === 'application/gzip'
  ) {
    return 'archive';
  }
  if (mt.includes('officedocument') || mt.includes('msword') ||
      mt.includes('ms-excel') || mt.includes('ms-powerpoint') ||
      mt.startsWith('application/vnd.oasis.opendocument')) {
    return 'document';
  }

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? 'other';
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function prettyFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const CATEGORY_LABEL: Record<FileCategory, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  text: 'Text',
  archive: 'Archive',
  document: 'Document',
  other: 'File',
};

function prettyMimeLabel(mimeType: string, category: FileCategory): string {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.toUpperCase();
  if (subtype && /^[A-Z0-9]{1,6}$/.test(subtype)) {
    return `${subtype} ${CATEGORY_LABEL[category]}`;
  }
  return CATEGORY_LABEL[category];
}

// ---------------------------------------------------------------------------
// Per-category visual config
// ---------------------------------------------------------------------------

interface CategoryStyle {
  icon: LucideIcon;
  bg: string;
  iconBg: string;
  iconColor: string;
}

const CATEGORY_STYLES: Record<FileCategory, CategoryStyle> = {
  image: {
    icon: ImageIcon,
    bg: 'bg-gradient-to-br from-sky-100 via-blue-50 to-cyan-100',
    iconBg: 'bg-white/80',
    iconColor: 'text-blue-600',
  },
  video: {
    icon: VideoIcon,
    bg: 'bg-gradient-to-br from-rose-100 via-pink-50 to-fuchsia-100',
    iconBg: 'bg-white/80',
    iconColor: 'text-rose-600',
  },
  audio: {
    icon: Music,
    bg: 'bg-gradient-to-br from-violet-100 via-purple-50 to-pink-100',
    iconBg: 'bg-white/80',
    iconColor: 'text-purple-600',
  },
  pdf: {
    icon: FileText,
    bg: 'bg-gradient-to-br from-red-100 via-orange-50 to-amber-100',
    iconBg: 'bg-white/80',
    iconColor: 'text-red-600',
  },
  text: {
    icon: FileText,
    bg: 'bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100',
    iconBg: 'bg-white/80',
    iconColor: 'text-slate-700',
  },
  archive: {
    icon: FileArchive,
    bg: 'bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-100',
    iconBg: 'bg-white/80',
    iconColor: 'text-amber-700',
  },
  document: {
    icon: FileText,
    bg: 'bg-gradient-to-br from-indigo-100 via-blue-50 to-sky-100',
    iconBg: 'bg-white/80',
    iconColor: 'text-indigo-600',
  },
  other: {
    icon: FileIcon,
    bg: 'bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200',
    iconBg: 'bg-white/80',
    iconColor: 'text-slate-600',
  },
};

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function IconPreview({ category }: { category: FileCategory }) {
  const style = CATEGORY_STYLES[category];
  const Icon = style.icon;
  return (
    <div className={`aspect-video flex items-center justify-center ${style.bg}`}>
      <div className={`p-5 rounded-2xl ${style.iconBg} shadow-sm backdrop-blur-sm`}>
        <Icon size={36} strokeWidth={1.5} className={style.iconColor} />
      </div>
    </div>
  );
}

function PreviewArea({
  file,
  category,
  canPreview,
}: {
  file: FileCardData;
  category: FileCategory;
  canPreview: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (canPreview && file.blobUrl) {
    if (category === 'image' && !imgFailed) {
      return (
        <div className="aspect-video bg-slate-100 relative overflow-hidden">
          <img
            src={file.blobUrl}
            alt={file.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        </div>
      );
    }

    if (category === 'video') {
      return (
        <div className="aspect-video bg-slate-900 relative overflow-hidden">
          <video
            src={file.blobUrl}
            controls
            preload="metadata"
            className="w-full h-full object-contain"
          />
        </div>
      );
    }

    if (category === 'audio') {
      const style = CATEGORY_STYLES.audio;
      return (
        <div className={`aspect-video flex flex-col items-center justify-center gap-3 px-4 ${style.bg}`}>
          <div className={`p-3 rounded-2xl ${style.iconBg} shadow-sm backdrop-blur-sm`}>
            <Music size={28} strokeWidth={1.5} className={style.iconColor} />
          </div>
          <audio
            src={file.blobUrl}
            controls
            preload="metadata"
            className="w-full max-w-[240px]"
          />
        </div>
      );
    }
  }

  return <IconPreview category={category} />;
}

// ---------------------------------------------------------------------------
// Kebab menu — three states: closed, open, confirming-delete
// ---------------------------------------------------------------------------

interface KebabMenuProps {
  onRenameStart: () => void;
  onDeleteConfirm: () => Promise<void> | void;
}

function KebabMenu({ onRenameStart, onDeleteConfirm }: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Click outside / Escape closes the menu and resets the confirm state.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
      setConfirming(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setConfirming(false);
      }
    };
    // Defer one tick so the click that opened the menu doesn't immediately close it.
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    document.addEventListener('keydown', handleKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteConfirm();
      // Component will be unmounted by the parent; no need to reset state.
    } catch {
      setDeleting(false);
      setConfirming(false);
      setOpen(false);
    }
  };

  return (
    <div className="absolute top-3 right-3 z-10">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
          setConfirming(false);
        }}
        aria-label="File actions"
        aria-expanded={open}
        className="
          w-9 h-9 rounded-full
          bg-white/85 backdrop-blur-md
          hover:bg-white shadow-md
          border border-white/60
          flex items-center justify-center
          transition-all duration-150
          active:scale-90
        "
      >
        <MoreVertical size={16} className="text-slate-700" strokeWidth={2.5} />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="
            absolute top-11 right-0 min-w-[170px]
            bg-white/95 backdrop-blur-xl
            border border-white/70
            rounded-2xl shadow-xl
            overflow-hidden
            animate-in fade-in slide-in-from-top-2 duration-150
          "
        >
          {confirming ? (
            <div className="p-1">
              <p className="px-3 py-2 text-xs font-semibold text-slate-600">
                Delete this file?
              </p>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="
                  w-full px-3 py-2 rounded-xl
                  text-sm font-bold text-red-600
                  hover:bg-red-50
                  flex items-center gap-2
                  transition-colors disabled:opacity-60
                "
              >
                {deleting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} strokeWidth={2.5} />
                )}
                <span>{deleting ? 'Deleting…' : 'Yes, delete'}</span>
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="
                  w-full px-3 py-2 rounded-xl
                  text-sm font-medium text-slate-600
                  hover:bg-slate-100
                  text-left
                  transition-colors
                "
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="p-1">
              <button
                onClick={() => {
                  setOpen(false);
                  onRenameStart();
                }}
                className="
                  w-full px-3 py-2 rounded-xl
                  text-sm font-medium text-slate-700
                  hover:bg-slate-100
                  flex items-center gap-2
                  transition-colors
                "
              >
                <Pencil size={14} strokeWidth={2.5} />
                <span>Rename</span>
              </button>
              <button
                onClick={() => setConfirming(true)}
                className="
                  w-full px-3 py-2 rounded-xl
                  text-sm font-medium text-red-600
                  hover:bg-red-50
                  flex items-center gap-2
                  transition-colors
                "
              >
                <Trash2 size={14} strokeWidth={2.5} />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function FileCard({ file, mode, onRename, onDelete }: FileCardProps) {
  const category = getFileCategory(file.mimeType, file.name);
  const canPreview = Boolean(file.blobUrl);
  //const canPreview = mode === 'receiver' && Boolean(file.blobUrl);
  const sizeLabel = prettyFileSize(file.sizeBytes);
  const typeLabel = prettyMimeLabel(file.mimeType, category);

  // Only sender mode + a settled file (has server-assigned id) + handlers
  // present unlocks the kebab menu.
  const canModify =
    mode === 'sender' && Boolean(file.id) && Boolean(onRename) && Boolean(onDelete);

  // --- Rename state ------------------------------------------------------
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // When entering rename mode, focus and select the basename (before extension)
  // — Finder/Explorer convention so the user can immediately type a new name
  // without overwriting the extension.
  useEffect(() => {
    if (!isRenaming || !inputRef.current) return;
    const input = inputRef.current;
    input.focus();
    const dot = input.value.lastIndexOf('.');
    if (dot > 0) {
      input.setSelectionRange(0, dot);
    } else {
      input.select();
    }
  }, [isRenaming]);

  const handleRenameStart = () => {
    setRenameValue(file.name);
    setIsRenaming(true);
  };

  const handleRenameCancel = () => {
    setIsRenaming(false);
    setRenameValue(file.name);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === file.name || !onRename || !file.id) {
      handleRenameCancel();
      return;
    }
    setRenameSaving(true);
    try {
      await onRename(file.id, trimmed);
      setIsRenaming(false);
    } catch {
      // Parent reverts optimistic state; we just exit the input.
      setIsRenaming(false);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!onDelete || !file.id) return;
    await onDelete(file.id);
  };

  return (
    <div className="group relative bg-white/60 border border-white/60 rounded-[1.5rem] overflow-hidden shadow-sm hover:shadow-lg hover:border-white/80 transition-all duration-300">
      <div className="relative">
        <PreviewArea file={file} category={category} canPreview={canPreview} />
        {canModify && !isRenaming && (
          <KebabMenu
            onRenameStart={handleRenameStart}
            onDeleteConfirm={handleDeleteConfirm}
          />
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="space-y-1 min-w-0">
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} className="space-y-2">
              <input
                ref={inputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    handleRenameCancel();
                  }
                }}
                disabled={renameSaving}
                maxLength={200}
                className="
                  w-full text-sm font-semibold text-slate-800
                  bg-white/90
                  border border-blue-400 focus:border-blue-500
                  rounded-lg px-2.5 py-1.5
                  focus:outline-none focus:ring-2 focus:ring-blue-400/40
                  disabled:opacity-60
                "
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={renameSaving || renameValue.trim().length === 0}
                  className="
                    inline-flex items-center gap-1.5
                    text-xs font-bold text-blue-600 hover:text-blue-700
                    disabled:opacity-50 disabled:cursor-not-allowed
                  "
                >
                  {renameSaving && <Loader2 size={12} className="animate-spin" />}
                  <span>{renameSaving ? 'Saving…' : 'Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRenameCancel}
                  disabled={renameSaving}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <span className="ml-auto text-[10px] text-slate-400 font-medium">
                  Enter to save · Esc to cancel
                </span>
              </div>
            </form>
          ) : (
            <p
              className="text-sm font-semibold text-slate-800 truncate"
              title={file.name}
            >
              {file.name}
            </p>
          )}
          {!isRenaming && (
            <p className="text-xs text-slate-500 font-medium tabular-nums">
              {sizeLabel} · {typeLabel}
            </p>
          )}
        </div>

        {!isRenaming && (mode === 'receiver' && file.blobUrl ? (
          <a
            href={file.blobUrl}
            target="_blank"
            rel="noreferrer"
            download={file.name}
            className="
              group/btn relative flex items-center justify-center gap-2
              bg-gradient-to-r from-blue-500 to-indigo-500
              hover:from-blue-600 hover:to-indigo-600
              text-white text-sm font-semibold tracking-wide
              px-4 py-2.5 rounded-xl
              shadow-md shadow-blue-500/25
              hover:shadow-lg hover:shadow-blue-500/40
              transition-all duration-200
              active:scale-[0.97]
            "
          >
            <Download
              size={16}
              strokeWidth={2.5}
              className="transition-transform duration-200 group-hover/btn:translate-y-0.5"
            />
            <span>Download</span>
          </a>
        ) : (
          <div
            className="
              flex items-center justify-center gap-1.5
              bg-emerald-50/80 text-emerald-700
              text-[11px] font-bold uppercase tracking-[0.1em]
              px-4 py-2 rounded-xl
              border border-emerald-200/60
            "
          >
            <Check size={13} strokeWidth={3} />
            <span>Sent</span>
          </div>
        ))}
      </div>
    </div>
  );
}