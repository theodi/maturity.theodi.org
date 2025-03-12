const path = require('path');
const fs = require('fs');

// Load environment variables securely
require("dotenv").config({ path: "./config.env" });

// MongoDB setup
const mongoose = require('mongoose');
const MongoStore = require("connect-mongo");


// Read MongoDB URI and database name from environment variables
const mongoURI = process.env.MONGO_URI;
const mongoDB = process.env.MONGO_DB;

const express = require('express');
const session = require('express-session');
const passport = require('./passport'); // Require the passport module
const authRoutes = require('./routes/auth'); // Require the authentication routes module
const projectRoutes = require('./routes/project'); // Require the project routes module
const assistantRoutes = require('./routes/assistant');
const assessmentsRoutes = require('./routes/assessment');
const { loadProject } = require('./middleware/project');
const loadAssessments = require('./lib/loadAssessments');
const { initializeScheduledJobs } = require('./controllers/hubspot');
 //const { getHubspotProfile, updateToolStatistics } = require('./controllers/hubspot');
const app = express();
const port = process.env.PORT || 3080;
app.set('view engine', 'ejs');
app.set("views", path.join(__dirname, "views")); // Ensure correct path


// Connect to MongoDB
mongoose.connect(mongoURI, {
  dbName: mongoDB,
  useNewUrlParser: true,
  useUnifiedTopology: true,
  // tls: true, // Ensure TLS is enabled
  // serverSelectionTimeoutMS: 50000, // Increase timeout
});

const db = mongoose.connection;

// Check MongoDB connection
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', function() {
  console.log("Connected to MongoDB database");
  loadAssessments();
});

// Middleware for logging
const logger = require('morgan');
app.use(logger('dev'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Other middleware and setup code...

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI, // Your MongoDB connection string
      dbName: process.env.MONGO_DB, // Your MongoDB database name
      collectionName: "sessions", // Name of the collection to store sessions
      crypto: {
        secret: process.env.SESSION_SECRET, // Encrypt session data
      },
    }),
    
    // cookie: {
    //   secure: true, // Set to true in production (HTTPS)
    //   httpOnly: true, // Prevents JavaScript access to cookies
    //   maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days expiration
    // },
  })
);

// Middleware for user object

// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
  res.locals.user = req.session.passport ? req.session.passport.user : req.session.user;
  next();
});

app.use((req, res, next) => {
  // Read package.json file
  fs.readFile(path.join(__dirname, 'package.json'), 'utf8', (err, data) => {
      if (err) {
          console.error('Error reading package.json:', err);
          return next();
      }

      try {
          const packageJson = JSON.parse(data);
          // Extract version from package.json
          var software = {};
          software.version = packageJson.version;
          software.homepage = packageJson.homepage;
          software.versionLink = packageJson.homepage + "/releases/tag/v" + packageJson.version;
          res.locals.software = software;
      } catch (error) {
          console.error('Error parsing package.json:', error);
      }

      next();
  });
});

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // HTTP 1.1.
  res.setHeader('Pragma', 'no-cache'); // HTTP 1.0.
  res.setHeader('Expires', '0'); // Proxies.
  next();
});

// Logout route
app.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// Middleware to ensure authentication
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated())
    return next();
  else
    unauthorised(res);
}

function unauthorised(res) {
  const page = {
    title: "Error"
  };
  res.locals.page = page;
  const error = new Error("Unauthorized access");
  error.status = 401;
  throw error;
}

// Routes

app.use(express.static(__dirname + '/public')); // Public directory


// Use authentication routes
app.use('/auth', authRoutes);

app.get('/admin', function(req,res) {
  res.redirect('/auth/google');
});

app.use(loadProject);
initializeScheduledJobs();

app.use('/assessments', assessmentsRoutes);
app.use('/projects', assistantRoutes);
app.use('/projects', projectRoutes);

app.get('/', function(req, res) {
  const page = {
    title: "ODI Maturity Assessment Tool",
    // link: "/"
    link: "/auth/local"
  };
  res.locals.page = page;
  // res.render('pages/home');
  res.render('pages/auth/localLogin');
});

app.get('/about', function(req, res) {
  const page = {
    title: "About",
    link: "/about"
  };
  res.locals.page = page;
  res.render('pages/about');
});

app.use(ensureAuthenticated, express.static(__dirname + '/private'));

// Error handling
app.get('/error', (req, res) => res.send("error logging in"));

app.get('*', function(req, res, next){
  const page = {
    title: "404 Not Found"
  };
  res.locals.page = page;
  const error = new Error("Not Found");
  error.status = 404;
  next(error);
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Default status code for unhandled errors
  let statusCode = 500;
  let errorMessage = "Internal Server Error";
  // Check if the error has a specific status code and message
  if (err.status) {
      statusCode = err.status;
      errorMessage = err.message;
  }
  const page = {
    title: "Error"
  };
  res.locals.page = page;

  // Log the error stack trace
  //console.error(err.stack);

  // Content negotiation based on request Accept header
  const acceptHeader = req.get('Accept');

  if (acceptHeader === 'application/json') {
      // Respond with JSON
      res.status(statusCode).json({ message: errorMessage });
  } else {
      // Respond with HTML (rendering an error page)
      res.status(statusCode).render('errors/error', { statusCode, errorMessage });
  }
});

// Start server
app.listen(port , () => console.log('App listening on port ' + port));