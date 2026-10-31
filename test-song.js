const test = async () => {
  const title = 'i like the way you kiss me';
  const artist = 'Artemas';
  const duration = 142;
  const videoId = 'jVBsM8CM0AE';

  console.log('1. Testing BiniLyrics...');
  try {
    const url = 'https://lyrics-api.binimum.org/?track=' + encodeURIComponent(title) + '&artist=' + encodeURIComponent(artist) + '&duration=' + duration;
    const r = await fetch(url);
    console.log('Bini status:', r.status);
    if (r.ok) {
      const data = await r.json();
      console.log('Bini results:', data?.results?.length, data?.results?.[0]?.lyricsUrl);
      if (data?.results?.[0]?.lyricsUrl) {
        const t = await fetch(data.results[0].lyricsUrl);
        console.log('Bini lyricsUrl status:', t.status);
      }
    }
  } catch (e) { console.log('Bini err:', e.message); }

  console.log('2. Testing BetterLyrics...');
  try {
    const url = 'https://lyrics-api.boidu.dev/getLyrics?s=' + encodeURIComponent(title) + '&a=' + encodeURIComponent(artist) + '&d=' + duration;
    const r = await fetch(url);
    console.log('BetterLyrics status:', r.status);
    if (r.ok) {
      const text = await r.text();
      console.log('BetterLyrics snippet:', text.slice(0, 100));
    }
  } catch (e) { console.log('Better err:', e.message); }

  console.log('3. Testing LyricsPlus...');
  try {
    const url = 'https://lyricsplus.binimum.org/v2/lyrics/get?title=' + encodeURIComponent(title) + '&artist=' + encodeURIComponent(artist) + '&duration=' + duration;
    const r = await fetch(url);
    console.log('LyricsPlus status:', r.status);
    if (r.ok) {
      const data = await r.json();
      console.log('LyricsPlus lyrics count:', data?.lyrics?.length);
    }
  } catch (e) { console.log('Plus err:', e.message); }

  console.log('4. Testing LRCLIB...');
  try {
    const url = 'https://lrclib.net/api/get?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist) + '&duration=' + duration;
    const r = await fetch(url, { headers: { 'Lrclib-Client': 'YTMusicBetterLyrics/2.0' } });
    console.log('LrcLib status:', r.status);
    if (r.ok) {
      const data = await r.json();
      console.log('LrcLib synced:', !!data?.syncedLyrics);
    } else {
      const searchUrl = 'https://lrclib.net/api/search?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist);
      const sr = await fetch(searchUrl, { headers: { 'Lrclib-Client': 'YTMusicBetterLyrics/2.0' } });
      const hits = await sr.json();
      console.log('LrcLib search hits:', hits?.length);
    }
  } catch (e) { console.log('Lrc err:', e.message); }
};
test();
