export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  streamUrl: string;
  coverUrl?: string;
  lyricUrl?: string;
}

export interface TrackListResponse {
  tracks: Track[];
}
