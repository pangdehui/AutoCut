import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";

interface VideoPlayerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  src?: string;
  poster?: string;
  isAudio?: boolean;
}

export default function VideoPlayer({ open, onClose, title, src, poster, isAudio }: VideoPlayerProps) {
  if (!src) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl p-0 bg-black border-0">
        <div className="relative">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>

          {title && (
            <div className="absolute top-3 left-3 z-10 text-white text-sm bg-black/50 px-3 py-1 rounded">
              {title}
            </div>
          )}

          {isAudio ? (
            <div className="flex items-center justify-center p-12">
              <audio controls autoPlay className="w-full max-w-md">
                <source src={src} />
              </audio>
            </div>
          ) : (
            <video
              controls
              autoPlay
              className="w-full max-h-[80vh] rounded-b-lg"
              poster={poster}
              src={src}
            >
              <source src={src} />
            </video>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
