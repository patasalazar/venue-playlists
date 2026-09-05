const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_USER_ID = process.env.SPOTIFY_USER_ID;

// Get Spotify access token
async function getSpotifyToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Spotify credentials not configured');
  }

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    throw new Error('Failed to authenticate with Spotify');
  }

  const data = await response.json();
  return data.access_token;
}

// Search for artist on Spotify
async function searchArtist(artistName, token) {
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.artists.items[0] || null;
  } catch (error) {
    console.error(`Error searching for ${artistName}:`, error);
    return null;
  }
}

// Get top tracks for an artist
async function getArtistTopTracks(artistId, token, limit = 2) {
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/artists/${artistId}/top_tracks?country=GB`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    return data.tracks.slice(0, limit).map(t => t.uri);
  } catch (error) {
    console.error(`Error getting tracks for artist ${artistId}:`, error);
    return [];
  }
}

// Create a new playlist
async function createPlaylist(playlistName, description, token, userId) {
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: playlistName,
          description: description,
          public: false
        })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to create playlist');
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating playlist:', error);
    throw error;
  }
}

// Add tracks to playlist
async function addTracksToPlaylist(playlistId, trackUris, token) {
  if (!trackUris.length) return;

  const chunks = [];
  for (let i = 0; i < trackUris.length; i += 100) {
    chunks.push(trackUris.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ uris: chunk })
        }
      );
    } catch (error) {
      console.error('Error adding tracks to playlist:', error);
    }
  }
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const { artists, playlistName, venues, genres } = JSON.parse(event.body);

    if (!artists || !artists.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No artists provided' })
      };
    }

    if (!SPOTIFY_USER_ID) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Spotify User ID not configured. Contact the site admin.' 
        })
      };
    }

    // Get Spotify token
    const token = await getSpotifyToken();

    // Search for artists and collect tracks
    const trackUris = [];
    const foundArtists = [];
    const notFoundArtists = [];

    for (const artistName of artists) {
      const artist = await searchArtist(artistName, token);

      if (artist) {
        const tracks = await getArtistTopTracks(artist.id, token, 2);
        if (tracks.length) {
          trackUris.push(...tracks);
          foundArtists.push(artistName);
        } else {
          notFoundArtists.push(artistName);
        }
      } else {
        notFoundArtists.push(artistName);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (!trackUris.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'No tracks found on Spotify for the selected artists' 
        })
      };
    }

    // Shuffle tracks
    for (let i = trackUris.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [trackUris[i], trackUris[j]] = [trackUris[j], trackUris[i]];
    }

    // Create playlist
    const description = `Created from ${foundArtists.length} artists across ${venues.join(', ')} (Genres: ${genres.join(', ')})`;
    const playlist = await createPlaylist(playlistName, description, token, SPOTIFY_USER_ID);

    // Add tracks to playlist
    await addTracksToPlaylist(playlist.id, trackUris, token);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        playlistUrl: playlist.external_urls.spotify,
        playlistId: playlist.id,
        trackCount: trackUris.length,
        artistsFound: foundArtists.length,
        artistsNotFound: notFoundArtists.length
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create playlist: ' + error.message })
    };
  }
};
