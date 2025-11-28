const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const routes = require('./app/frame/route');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', routes);

app.listen(PORT, () => {
  console.log(`Base TVL mini-app listening on port ${PORT}`);
});
