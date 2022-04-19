var express = require("express");
var http = require("http");
var path = require("path");
var bodyParser = require("body-parser");
var helmet = require("helmet");
const axios = require("axios");

const OMDB_KEY = process.env.OMDB_KEY;
const MOVIEDB_KEY = process.env.MOVIEDB_KEY;

const MOVIEDB_POSTER_URL_BIG = "https://image.tmdb.org/t/p/w300";
const MOVIEDB_POSTER_URL_SMALL = "https://image.tmdb.org/t/p/w185"; // 154 185 300 500

var app = express();
var server = http.createServer(app);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "./public")));
app.use(helmet());

function get_from_omdb(movie) {
  const params = {
    params: {
      apikey: OMDB_KEY,
      type: "movie",
      t: movie,
    },
  };

  return new Promise((resolve) => {
    axios
      .get(`http://www.omdbapi.com/`, params)
      .then((res) => {
        if (res.status != 200 || res.data.Response == "False") {
          resolve(null);
        } else {
          resolve(res.data);
        }
      })
      .catch((error) => resolve(null));
  });
}

function get_from_moviedb(movie) {
  const params = {
    params: {
      api_key: MOVIEDB_KEY,
      page: 1,
      query: movie,
    },
  };

  return new Promise((resolve) => {
    axios
      .get(`https://api.themoviedb.org/3/search/movie`, params)
      .then((res) => {
        if (res.status != 200 || res.data.total_results == 0) {
          resolve(null);
        } else {
          let data = res.data.results[0];
          let title = data.title;
          let ids = data.id;
          const params_similar = {
            params: {
              api_key: MOVIEDB_KEY,
              page: 1,
              query: movie,
            },
          };
          axios
            .get(
              `https://api.themoviedb.org/3/movie/${ids}/similar`,
              params_similar
            )
            .then((res_) => {
              if (res.status != 200) {
                data["similar"] = [];
                resolve(data);
              } else {
                data["similar"] = res_.data;
                resolve(data);
              }
            });
        }
      })
      .catch((error) => resolve(null));
  });
}

async function get_movie(movie) {
  var moviedb_data = get_from_moviedb(movie);
  var omdb_data = get_from_omdb(movie);
  return {
    omdb: await omdb_data,
    moviedb: await moviedb_data,
  };
}

const get_avg = (list) => list.reduce((a, b) => a + b) / list.length;
const get_round = (num) => Math.round(num * 100) / 100;

function get_result(movie) {
  return new Promise((resolve) => {
    get_movie(movie).then((res) => {
      // if data from moviedb and omdb is not about same movie, send request to omdb (which is less trusted)
      if (
        res.moviedb != null &&
        (res.omdb == null || res.omdb.Title != res.moviedb.title)
      ) {
        console.log("Trying again to get from omdb", res.moviedb.title);
        if (res.omdb != null) console.log(res.omdb.Title);
        get_from_omdb(res.moviedb.title).then((_res) => {
          res.omdb = _res;
          resolve(res);
        });
      } else resolve(res);
    });
  });
}

function get_title(res) {
  if (res.moviedb != null) return res.moviedb.title;
  else if (res.omdb != null) return res.omdb.Title;
  return "not found";
}

function get_year(res) {
  if (res.moviedb != null) return res.moviedb.release_date;
  else if (res.omdb != null) return res.omdb.Released;
  return "not found";
}

function get_poster_path(res) {
  if (res.moviedb != null)
    return MOVIEDB_POSTER_URL_BIG + res.moviedb.poster_path;
  else if (res.omdb != null) return res.omdb.Poster;
  return "";
}

function get_bootstrap() {
  return `<link href="https://stackpath.bootstrapcdn.com/bootstrap/4.1.3/css/bootstrap.min.css" rel="stylesheet"/>`;
}

function create_header(res) {
  return (
    get_bootstrap() +
    `<h1 class="font-weight-bold" >${get_title(res)}</h1>
          <h4 class="" >Premiere: ${get_year(res)}</h4><hr>
          <img crossorigin="anonymous" src="${get_poster_path(res)}">
          <hr>`
  );
}

function create_similar(res) {
  if (res == null) return ``;
  let result = ``;

  for (movie of res.similar.results) {
    result +=
      `<div>` +
      `<img crossorigin="anonymous" src="${
        MOVIEDB_POSTER_URL_SMALL + movie.poster_path
      }">` +
      `<p>${movie.title}</p>` +
      `</div>`;
  }

  return `<h1 class="" >
            Similar movies
          </h1>
          <div class="d-flex justify-content-around flex-wrap p-5">
            ${result}
          </div>
          <hr>`;
}

function create_ratings(res) {
  let ratings = ``;
  if (res.moviedb != null)
    ratings += `<p>MovieDB: ${res.moviedb.vote_average}</p>`;
  if (res.omdb != null) {
    ratings += `<p>IMDB: ${res.omdb.imdbRating}</p>`;
    ratings += `<p>Metascore: ${res.omdb.Metascore}</p>`;
    for (rate of res.omdb.Ratings) {
      ratings += `<p>${rate.Source}: ${rate.Value}</p>`;
    }
  }
  return `<h1 class="">
            Ratings
          </h1>
            ${ratings}
          <hr>`;
}

function create_own_rating(rating) {
  return `<h1 class="" >
            Your rating
          </h1>
          <p>Based on parameters your rating is <a class="font-weight-bold">${rating}</a></p>
          <hr>`;
}

function create_credits() {
  return `<footer class="footer">
            <h2>APIs Providers</h2>
            <p>OMDB API - <a href="http://www.omdbapi.com/">http://www.omdbapi.com/</a></p>
            <p>This product uses the TMDB API but is not endorsed or certified by TMDB - 
                <a href="https://www.themoviedb.org/">https://www.themoviedb.org/</a>
            </p>
          </footer>`;
}

function calculate_own_rating(
  res,
  movieDB_ratio,
  imdb_ratio,
  rotten_ratio,
  metacritic_ratio,
  metascore_ratio
) {
  let score = 0;
  let wages = 0;
  let movieDB = res.moviedb;
  let omdb = res.omdb;

  if (movieDB != null && movieDB.vote_average) {
    score += Number(movieDB.vote_average) * movieDB_ratio;
    wages += movieDB_ratio;
  }

  if (omdb != null) {
    if (omdb.imdbRating != "N/A") {
      score += Number(omdb.imdbRating) * imdb_ratio;
      wages += imdb_ratio;
    }
    if (omdb.Metascore != "N/A") {
      score += (Number(omdb.Metascore) / 10.0) * metascore_ratio;
      wages += metascore_ratio;
    }

    for (rating of omdb.Ratings) {
      if (rating.Source == "Rotten Tomatoes") {
        score += (parseFloat(rating.Value) / 10.0) * rotten_ratio;
        wages += rotten_ratio;
      } else if (rating.Source == "Metacritic") {
        let s = rating.Value.split("/");
        s = parseInt(s[0], 10) / parseInt(s[1], 10);
        score += s * 10 * metacritic_ratio;
        wages += metacritic_ratio;
      }
    }
  }

  if (wages > 0) score = score / wages;
  else score = 0.0;

  return score.toFixed(1);
}

app.get("/", function (req, res) {
  res.sendFile(path.join(__dirname, "./public/index.html"));
});

app.get("/find", function (req, res) {
  res.redirect("/");
});

// Insert
app.post("/find", function (req, res) {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "script-src 'self' https://apis.google.com"
  );
  if (!req.body.movie) {
    res.send("No parameters given");
  } else {
    let movie = req.body.movie;
    let movieDB_ratio = Number(req.body.movieDB);
    let imdb_ratio = Number(req.body.imdb);
    let rotten_ratio = Number(req.body.rotten);
    let metacritic_ratio = Number(req.body.metacritic);
    let metascore_ratio = Number(req.body.metascore);

    get_result(movie).then((r) => {
      if (r.moviedb == null && r.omdb == null) {
        res.send(
          get_bootstrap() +
            `
                      <div class="text-center">
                      <h1>
                        No '${movie}' movie found
                      </h1><hr>` +
            create_credits()
        ) + `</div>`;
      } else {
        let rating = calculate_own_rating(
          r,
          movieDB_ratio,
          imdb_ratio,
          rotten_ratio,
          metacritic_ratio,
          metascore_ratio
        );
        let bootstrap = get_bootstrap();
        let header = create_header(r);
        let ratings = create_ratings(r);
        let own_rating = create_own_rating(rating);
        let similar = create_similar(r.moviedb);
        let credits = create_credits();

        let page =
          bootstrap +
          `<div class="text-center">` +
          header +
          ratings +
          own_rating +
          similar +
          credits +
          `</div`;
        res.send(page);
      }
    });
  }
});

server.listen(process.env.PORT, () => {
  console.log("Listening ...");
});
