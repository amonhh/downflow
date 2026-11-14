// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  parseDashManifest,
  parseIsoDuration,
  selectDashRepresentations,
} from '../src/media/dash-detector';

const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"
     mediaPresentationDuration="PT1H2M3S">
  <BaseURL>https://cdn.example/dash/</BaseURL>
  <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" />
  <Period duration="PT30S">
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <SegmentTemplate timescale="1000" duration="5000" startNumber="1"
        initialization="video/init-$RepresentationID$.mp4"
        media="video/segment-$RepresentationID$-$Number%05d$.m4s" />
      <Representation id="v1" bandwidth="800000" width="1280" height="720" codecs="avc1.4d401f" />
      <Representation id="v2" bandwidth="2400000" width="1920" height="1080" codecs="avc1.640028" />
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio" lang="en">
      <Representation id="a1" bandwidth="128000" audioSamplingRate="48000">
        <SegmentList>
          <Initialization sourceURL="audio/init.mp4" />
          <SegmentURL media="audio/a1.m4s" />
          <SegmentURL media="audio/a2.m4s" />
        </SegmentList>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

describe('ISO 8601 durations', () => {
  it('parses day, hour, minute and second components', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('P1DT30M')).toBe(88_200);
    expect(parseIsoDuration('PT0.5S')).toBe(0.5);
  });

  it('returns undefined for missing or malformed values', () => {
    expect(parseIsoDuration(null)).toBeUndefined();
    expect(parseIsoDuration('1 hour')).toBeUndefined();
  });
});

describe('DASH manifest parsing', () => {
  it('extracts representations, templates and base URLs', () => {
    const result = parseDashManifest(manifest, 'https://origin.example/manifests/stream.mpd');
    expect(result.protected).toBe(true);
    expect(result.protectionSystems).toContain('urn:mpeg:dash:mp4protection:2011');
    expect(result.isDynamic).toBe(false);
    expect(result.duration).toBe(3723);
    expect(result.representations).toHaveLength(3);

    const video = result.representations.find((representation) => representation.id === 'v1');
    expect(video).toMatchObject({
      type: 'video',
      mime: 'video/mp4',
      width: 1280,
      height: 720,
      bandwidth: 800000,
      startNumber: 1,
      timescale: 1000,
      segmentDuration: 5,
      segmentCount: 6,
      baseUrl: 'https://cdn.example/dash/',
    });
    expect(video?.initUrl).toBe('https://cdn.example/dash/video/init-v1.mp4');
    expect(video?.segmentUrls?.[0]).toBe('https://cdn.example/dash/video/segment-v1-00001.m4s');
    expect(video?.segmentUrls?.at(-1)).toBe('https://cdn.example/dash/video/segment-v1-00006.m4s');
  });

  it('supports SegmentList representations', () => {
    const result = parseDashManifest(manifest, 'https://origin.example/manifests/stream.mpd');
    const audio = result.representations.find((representation) => representation.id === 'a1');
    expect(audio).toMatchObject({
      type: 'audio',
      mime: 'audio/mp4',
      initUrl: 'https://cdn.example/dash/audio/init.mp4',
      segmentCount: 2,
    });
    expect(audio?.segmentUrls).toEqual([
      'https://cdn.example/dash/audio/a1.m4s',
      'https://cdn.example/dash/audio/a2.m4s',
    ]);
  });

  it('sorts downloadable representations by quality', () => {
    const result = parseDashManifest(manifest, 'https://origin.example/manifests/stream.mpd');
    const selected = selectDashRepresentations(result.representations);
    expect(selected.video.map((representation) => representation.id)).toEqual(['v2', 'v1']);
    expect(selected.audio.map((representation) => representation.id)).toEqual(['a1']);
  });

  it('rejects non-MPD XML and manifests without representations', () => {
    expect(() => parseDashManifest('<html />', 'https://example.com/manifest.mpd')).toThrow(/not a DASH MPD/);
    expect(() =>
      parseDashManifest('<MPD type="static"><Period></Period></MPD>', 'https://example.com/manifest.mpd'),
    ).toThrow(/No downloadable representations/);
  });

  it('marks dynamic manifests honestly', () => {
    const live = parseDashManifest(
      `<MPD type="dynamic"><Period><AdaptationSet contentType="video" mimeType="video/mp4"><Representation id="v"><BaseURL>chunk.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`,
      'https://example.com/live.mpd',
    );
    expect(live.isDynamic).toBe(true);
    expect(live.protected).toBe(false);
  });
});
