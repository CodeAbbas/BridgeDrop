'use client';

/**
 * FileCard — a glassmorphic file tile with a type-aware preview area
 * and a download action that fits BridgeDrop's visual language.
 *
 * Preview behaviour:
 *   - image/* → <img> rendered directly from the SAS-signed blobUrl,
 *               with a graceful fallback to a tinted icon if it fails to load.
 *   - video/* → native <video controls preload="metadata"> so only the first
 *               frame and metadata download until the user presses play.
 *   - audio/* → tinted panel with a music icon and native <audio controls>.
 *   - pdf / text / archive / document / other → gradient panel with a coloured
 *               category icon. No live rendering — keeps the UI fast and
 *               avoids cross-origin iframe pitfalls.
 *
 * Sender vs receiver:
 *   - Sender's blobUrl is the clean (un-SAS-signed) URL and the container is
 *     private, so previews would 403. Sender gets the icon view plus a "Sent"
 *     badge in place of the download button.
 *   - Receiver's blobUrl already carries a 1-hour read SAS (minted by
 *     /api/room/[roomId]), so previews work directly.
 */

import { useState } from 'react';
import {
  Check,
  Download,
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Music,
  Video as VideoIcon,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structurally compatible with BridgeDrop's existing FileMeta —
 * any object with these fields can be passed without extra mapping.
 */
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
  // image
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
  webp: 'image', svg: 'image', bmp: 'image', heic: 'image', avif: 'image',
  // video
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', avi: 'video', m4v: 'video',
  // audio
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio',
  // pdf
  pdf: 'pdf',
  // text
  txt: 'text', md: 'text', json: 'text', xml: 'text', csv: 'text',
  log: 'text', yml: 'text', yaml: 'text', html: 'text', css: 'text', js: 'text', ts: 'text',
  // archive
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  // document
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

  // Fallback: extension sniffing for files served with a generic
  // application/octet-stream MIME (common for unknown extensions).
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
  // Try to surface the subtype: "image/jpeg" → "JPEG Image".
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
  /** Outer gradient on the preview panel. */
  bg: string;
  /** Inner pill that wraps the icon glyph. */
  iconBg: string;
  /** Icon stroke colour. */
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
  // `imgFailed` flips us to the icon fallback if a SAS expires mid-session
  // or the URL is otherwise unreachable — avoids the broken-image glyph.
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

  // Sender side, non-previewable types, or image fallback — show the icon panel.
  return <IconPreview category={category} />;
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function FileCard({ file, mode }: FileCardProps) {
  const category = getFileCategory(file.mimeType, file.name);
  const canPreview = Boolean(file.blobUrl); //mode === 'receiver' && Boolean(file.blobUrl);
  const sizeLabel = prettyFileSize(file.sizeBytes);
  const typeLabel = prettyMimeLabel(file.mimeType, category);

  return (
    <div className="group bg-white/60 border border-white/60 rounded-[1.5rem] overflow-hidden shadow-sm hover:shadow-lg hover:border-white/80 transition-all duration-300">
      <PreviewArea file={file} category={category} canPreview={canPreview} />

      <div className="p-4 space-y-3">
        <div className="space-y-1 min-w-0">
          <p
            className="text-sm font-semibold text-slate-800 truncate"
            title={file.name}
          >
            {file.name}
          </p>
          <p className="text-xs text-slate-500 font-medium tabular-nums">
            {sizeLabel} · {typeLabel}
          </p>
        </div>

        {mode === 'receiver' && file.blobUrl ? (
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
        )}
      </div>
    </div>
  );
}