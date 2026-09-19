require('dotenv').config()

const express = require('express')
const expressLayouts = require('express-ejs-layouts')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')

// require spotify-web-api-node package here:
const SpotifyWebApi = require('spotify-web-api-node')



const app = express()

// Security headers. The default policy only allows resources from our own
// origin, which would block the artwork and previews we render, so Spotify's
// image and audio hosts are allowed explicitly.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'https://i.scdn.co'],
      'media-src': ["'self'", 'https://p.scdn.co'],
    },
  },
}))

// Our routes are a thin proxy in front of the Spotify API, and the quota they
// spend belongs to our own credentials. Cap how fast a single client can use
// it up.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many requests. Please wait a few minutes and try again.',
}))

app.use(expressLayouts)
app.set('view engine', 'ejs')
app.set('views', __dirname + '/views')
app.use(express.static(__dirname + '/public'))

// setting the spotify-api goes here:
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
})

// Client credentials tokens expire after about an hour, so we cannot fetch one
// at startup and keep using it. We remember when the current one runs out and
// request a new one shortly before that happens.
let tokenExpiresAt = 0

async function ensureAccessToken() {
  // Refresh a minute early so a request never travels with a token that
  // expires while it is in flight.
  if (Date.now() < tokenExpiresAt - 60 * 1000) return

  const data = await spotifyApi.clientCredentialsGrant()
  spotifyApi.setAccessToken(data.body['access_token'])
  tokenExpiresAt = Date.now() + data.body['expires_in'] * 1000
  console.log('Access token refreshed')
}

// Warm up the token on startup so the first visitor does not pay for it.
// A failure here is not fatal: the routes fetch a token on demand anyway.
ensureAccessToken().catch(error =>
  console.log('Something went wrong when retrieving an access token', error)
)


// Our routes go here:


app.get('/', (req, res) => {
  res.render('index')
})

// Route for artist search

app.get('/artist-search', async (req, res) => {
  const searchTerm = req.query.searchTerm // Searchterm from Query-String-Parameter

  if (!searchTerm || !searchTerm.trim()) {
    return res.status(400).render('error', {
      message: 'Please enter an artist name to search for.'
    })
  }

  try {
    await ensureAccessToken()
    const data = await spotifyApi.searchArtists(searchTerm) // Search for artists

    const artists = data.body.artists.items.map(artist => {
      return {
        id: artist.id,
        name: artist.name,
        image: artist.images.length > 0 ? artist.images[0].url : null
      }
    })

    // Data to Ejs and rendering
    res.render('artist-search-results', { artists })
  } catch (err) {
    console.log('Error at artist-search: ', err.message)
    res.status(500).render('error', {
      message: 'Sorry, the artist search failed. Please try again.'
    })
  }
})



// Route for albums
app.get('/albums/:artistId', async (req, res) => {
  const artistId = req.params.artistId // Artist-ID from URL

  try {
    await ensureAccessToken()
    const data = await spotifyApi.getArtistAlbums(artistId) // Get albums from artist

    // Data to Ejs and rendering
    res.render('albums', { albums: data.body.items })
  } catch (err) {
    console.log('Error at album-search: ', err.message)
    res.status(500).render('error', {
      message: 'Sorry, we could not load the albums for this artist.'
    })
  }
})



// Route für die Trackansicht
app.get('/tracks/:albumId', async (req, res) => {
  const albumId = req.params.albumId // Album-ID from URL

  try {
    await ensureAccessToken()
    const data = await spotifyApi.getAlbumTracks(albumId) // Get album tracks

    // Data to Ejs and rendering
    res.render('tracks', { tracks: data.body.items })
  } catch (err) {
    console.log('Error with tracks: ', err.message)
    res.status(500).render('error', {
      message: 'Sorry, we could not load the tracks for this album.'
    })
  }
})


// Anything we have no route for still deserves an answer.
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' })
})


app.listen(3000, () => console.log('My Spotify project running on port 3000 🎧 🥁 🎸 🔊'))
