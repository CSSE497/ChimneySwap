var express  = require('express');
var passport = require('passport');
var session = require('express-session');
var GoogleStrategy = require('passport-google-oauth2').Strategy;
var config = require('config.json')('./config.json');

var path = require('path');
var fs = require('fs');

var GOOGLE_CONSUMER_KEY = config.apiKey;
var GOOGLE_CONSUMER_SECRET = config.apiSecret;

var PORT = 3000;

var database = {
	users:{},
	chimneys:{},
	sharedChimneys:{}
}

function Record(table,constructor){
	this.table = table;
}

Record.prototype.cascade = function(fun){
	Object.keys(this).forEach(function(key){
		var prop = this[key];
		if(prop instanceof Object){
			Object.keys(prop).forEach(function(k){
				v = prop[k];
				fun(k,v);
			});
		}
	});
};

/*
Record.prototype.update = function(){
	var record = this.table[this.id];
	var old = this;
	this.updateCascade(
	this.cascade(function(table, key, value){
		value.upsert();
		record[table][key] = value;
	});
	return record;
};
*/

Record.prototype.insert = function(){
	this.table[this.id] = this;
	this.insertCascade();
	return this;
};

Record.prototype.cascadeInsert = function(){};

Record.prototype.remove = function(){
	delete this.table[this.id];
	this.cascade(function(table, key, value){
		value.remove();
	});
	return this;
};

Record.prototype.cascadeDelete = function(){};

/*
Record.prototype.upsert = function(){
	if(this.table[this.id]){
		return this.update();
	} else {
		return this.insert();
	}
}
*/

function User(profile){
	this.id = profile.id;
	this.firstName = profile.name.givenName;
	this.lastName = profile.name.familyName;
	this.email = profile.email;
	this.chimneys = {};
}

User.prototype = new Record(database.users);

function Chimney(user, address, imageUrl){
	this.id = null;
	this.user = user;
	this.address = address;
}

Chimney.prototype = new Record(database.chimneys);

Chimney.nextId = 1;

Chimney.prototype.insert = function(){
	if(this.id === null){
		this.id = Chimney.nextId++;
	}
	return Record.prototype.insert.call(this);
}

Chimney.prototype.resource = function(){
	if(this.id === null)
		throw new Error("Can't create resource, chimney has no id");
	return JSON.stringify({
		id:      this.id,
		userId:  this.user.id,
		address: this.address,
		image:   'images/'+this.id+'.png'
	});
};

passport.serializeUser(function(user, done) {
	done(null, user);
});

passport.deserializeUser(function(obj, done) {
	done(null, obj);
});

passport.use(new GoogleStrategy(
	{
		clientID: GOOGLE_CONSUMER_KEY,
		clientSecret: GOOGLE_CONSUMER_SECRET,
		callbackURL: 'http://localhost:3000/auth/google/return',
		passReqToCallback   : true
	},
	function(req, accessToken, refreshToken, profile, done){
		console.log(profile);
		var user = User.upsert(new User(profile));
		done(null, user);
	}
));

var app = express();

app.use(session({
	secret:'shh! this is a secret',
	resave:false,
	saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/logout',function(req, res){
	req.logout();
	req.redirect('/');
});

app.set('views','./views');

app.set('view engine', 'jade');

app.get('/', function(req, res){
	res.render('index',{theme:"slate"});
});

app.get('/home', function(req,res){
	res.render('home');
});

app.get('/auth/google',
	passport.authenticate('google', {
		scope: ["https://www.googleapis.com/auth/userinfo.email",
		        "https://www.googleapis.com/auth/userinfo.profile"]
	})
);

app.get('/auth/google/return',
	passport.authenticate('google', {
		failureRedirect: '/',
		successRedirect: '/home',
		failureFlash: "FAILED TO LOGIN"
	})
);

app.post('/chimney', function (req, res) {
	var user = database.users[req.session.id];
	var address = req.param('address');
	var chimney = new Chimney(user, address, imageUrl);
	var tempPath = req.files.file.path;
	chimney.insert();
	var targetPath = path.resolve('./images/'+chimney.id+'.png');
	if (path.extname(req.files.file.name).toLowerCase() === '.png') {
		fs.rename(tempPath, targetPath, function(err) {
			if (err) throw err;
			console.log("Upload completed!");
			res.status(201).send();
		});
	} else {
		fs.unlink(tempPath, function () {
			if (err) throw err;
			res.status(400).send('image must be a png');
		});
	}
});

app.get('/chimney', function (req, res){
	var id = req.param('id');
	var chimney = database.chimneys[id];
	if(!chimney){
		res.status(404).send("Chimney Not Found");
	}
	res.setHeader('Content-Type', 'application/json');
	res.status(200).send(chimney.resource());
});

app.listen(PORT);
console.log("started server on port "+PORT);

