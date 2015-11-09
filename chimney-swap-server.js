var express  = require('express');
var https = require('https');
var bodyParser  = require('body-parser');
var passport = require('passport');
var session = require('express-session');
var GoogleStrategy = require('passport-google-oauth2').Strategy;
var config = require('config.json')(__dirname+'/config.json');

var path = require('path');
var fs = require('fs');

var GOOGLE_CONSUMER_KEY = config.apiKey;
var GOOGLE_CONSUMER_SECRET = config.apiSecret;
var DOMAIN_NAME = config.domainName;
var PORT = config.port;
var SERVER_URL = "http://"+DOMAIN_NAME+":"+PORT;

var app = express();

function geocode(address,done,error){
	var url = "https://maps.googleapis.com/maps/api/geocode/json";
	var params = {
		'address':address,
		'key':GOOGLE_CONSUMER_KEY
	};
	https.request({
			host:'maps.googleapis.com',
			path:'/maps/api/geocode/json?address='+address+'&key='+GOOGLE_CONSUMER_KEY,
			method:'GET'
		}, function(response){
			var str = '';
			response.on('data',function(dat){
				str += dat;
			});
			response.on('end',function(){
				done(JSON.parse(str));
			});
			response.on('error',function(err){
				error(err);
			});
		}
	);
}

var database = {
	users:{},
	chimneys:{},
	sharedChimneys:{}
}

function Record(table,constructor){
	this.table = table;
}

Record.prototype.insert = function(){
	this.table[this.id] = this;
	this.insertCascade();
	return this;
};

Record.prototype.insertCascade = function(){};

Record.prototype.remove = function(){
	delete this.table[this.id];
	this.deleteCascade();
	return this;
};

Record.prototype.deleteCascade = function(){};

function User(profile){
	var rec = this.table[this.id];
	if(rec){
		rec.firstName = profile.name.givenName;	
		rec.lastName = profile.name.familyName;
		rec.email = profile.email;
		return rec;
	}
	this.id = profile.id;
	this.firstName = profile.name.givenName;
	this.lastName = profile.name.familyName;
	this.email = profile.email;
	this.chimneys = {};
}

User.prototype = new Record(database.users);

User.prototype.homeView = function(){
	var user = this;
	return {
		myChimneys:Object.keys(this.chimneys).map(function(key){
			return user.chimneys[key];
		}),
		sharedChimneys:Object.keys(database.sharedChimneys).filter(function(key){
			return !(key in user.chimneys);	
		}).map(function(key){
			return database.sharedChimneys[key];
		})
	};
}

function Chimney(name, user, position){
	this.id = null;
	this.name = name;
	this.user = user;
	this.position = position;
}

Chimney.prototype = new Record(database.chimneys);

Chimney.nextId = 1;

Chimney.prototype.insert = function(){
	if(this.id === null){
		this.id = Chimney.nextId++;
	}
	console.log('inserting new chimney with id: '+this.id);
	var ret = Record.prototype.insert.call(this);
	ret.share();
	return ret;
};

Chimney.prototype.remove = function(){
	return Resource.prototype.remove.call(this);
}

Chimney.prototype.insertCascade = function(){
	console.log(this.user);
	if(this.user){
		this.user.chimneys[this.id] = this;
	}
};

Chimney.prototype.resource = function(){
	if(this.id === null)
		throw new Error("Can't create resource, chimney has no id");
	var obj = {
		id:       this.id,
		name:     this.name,
		position: this.position,
		address:  this.address,
		image:    this.imageUrl
	};
	if(this.user){
		obj.userId = this.user.id;
	}
	return JSON.stringify(obj);
};

Chimney.prototype.imageUrl = function(){
	return SERVER_URL+'/images/'+this.id+'.png';
};

Chimney.prototype.share = function(){
	database.sharedChimneys[this.id] = this;
};

Chimney.prototype.unshare = function(){
	delete database.sharedChimneys[this.id];
};

passport.serializeUser(function(user, done) {
	done(null, user.id);
});

passport.deserializeUser(function(id, done) {
	done(null, database.users[id]);
});

passport.use(new GoogleStrategy(
	{
		clientID: GOOGLE_CONSUMER_KEY,
		clientSecret: GOOGLE_CONSUMER_SECRET,
		callbackURL: SERVER_URL+'/auth/google/return',
		passReqToCallback   : true
	},
	function(req, accessToken, refreshToken, profile, done){
		var user = new User(profile);
		if(!database.users[user.id]){
			user.insert();
		}
		done(null, user);
	}
));

app.use(bodyParser.json({limit:'50mb'}));
//app.use(bodyParser.urlencoded({limit:'50mb', extended:true}));


app.use(session({
	secret:'shh! this is a secret',
	resave:false,
	saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/images', express.static(__dirname + '/images'));

app.get('/logout',function(req, res){
	req.logout();
	req.redirect('/');
});

app.set('views', __dirname + '/views');

app.set('view engine', 'jade');

app.get('/', function(req, res){
	res.render('index',{theme:"slate"});
});

app.get('/home', function(req,res){
	console.log(req.session);
	console.log(database.users);
	res.render('home', database.users[req.session.passport.user].homeView());
});

app.get('/auth/google',
	passport.authenticate('google', {
		scope: ["https://www.googleapis.com/auth/userinfo.email",
		        "https://www.googleapis.com/auth/userinfo.profile"]
	})
);

app.get('/auth/google/return',
	passport.authenticate('google', {
		failureRedirect: SERVER_URL+'/',
		successRedirect: SERVER_URL+'/home',
		failureFlash: true
	})
);

app.post('/chimney', function (req, res) {
	console.log(req);
	var user = null;
	if(req.session && req.session.passport && req.session.passport.user){
		user = database.users[req.session.passport.user];
	}
	var address = req.param('address');
	var latitude = req.param('latitude');
	var longitude = req.param('longitude');
	var position = req.param('position');
	var name = req.param('name');
	var img = req.param('image');
	function makeChimney(position){
		console.log("Sample application trying to make chimney in makeChimney at position: "+position);
		var chimney = new Chimney(name, user, address);
		chimney.insert();
		var targetPath = path.resolve(__dirname+'/'+chimney.imageUrl());
		if(img){
			console.log("WRITING IMAGE");
			fs.writeFile(targetPath, img.file_data, 'base64', function(err){
				if(err) {
					console.log(err);
					res.setHeader('Content-Type', 'text/plain');
					res.status(401).send('bad image');
				} else
					res.status(201).send();
			});
		} else if (req.files.file) {
				var tempPath = req.files.file.path;
				fs.rename(tempPath, targetPath, function(err) {
					if (err) {
						console.log(err);
						res.setHeader('Content-Type', 'text/plain');
						res.status(401).send('bad image');
					} else
						res.status(201).send();
				});
		} else {
			fs.unlink(tempPath, function () {
				res.status(400).send('No image');
			});
		}
	}
	if(latitude){
		if(longitude){
			makeChimney({lat: latitude, lng: longitude});
		} else {
			res.setHeader('Content-Type', 'text/plain');
			req.status(401).send('no longitude provided');
			return;
		}
	} else if(position){
		makeChimney(position);
	} else if(address){
		geocode(address, makeChimney, function(err){
			console.error(err);
			res.status(500).send();	
		});
	} else {
		res.setHeader('Content-Type', 'text/plain');
		res.status(401).send("Address or Position Required");
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

app.delete('/chimney', function(req, res){
	var id = req.param('id');
	if(!id){
		res.setHeader('Content-Header', 'text/plain');
		res.status(401).send('deleting a chimney requires an id');
		return;
	}
	var chimney = database.chimneys[id];
	if(chimney){
		chimney.remove();
		res.status(200).send();
		return;
	}
	res.setHeader('Content-Header', 'text/plain');
	res.status(404).send("No chimney with id: "+id);
});

app.get('/chimneys', function (req, res){
	res.setHeader('Content-Type', 'application/json');
	res.status(200).send(
		'['+Object.keys(database.sharedChimneys).map(
			function(k){
				return database.sharedChimneys[k].resource();
			}
		).join(',')+']'
	);
});

app.use('/', express.static(__dirname + '/public'));

app.listen(PORT);
console.log("started server on: "+SERVER_URL);

var user = new User({"id":"109986445607396986536", "name":{"givenName":"Dan","familyName":"Hanson"}, "email":"danielghanson93@gmail.com"}).insert();

var pos = {lat:39.44,lng:-87.34};
var x = new Chimney("Red Chimney", user, pos).insert();
x.position = {lat:39.44,lng:-87.34};

x = new Chimney("Silver Stack", user, pos).insert();
x.position = {lat:39.44,lng:-87.34};

x = new Chimney("Cinder Smokeshaft", null, pos).insert();

x = new Chimney("Amber Pillar", null, pos).insert();

x = new Chimney("Bricked Square Shaft", null, pos).insert();

x = new Chimney("Victorian Ventilator", null, pos).insert();

x = new Chimney("Chimney Rock", null, pos).insert();

x = new Chimney("Twisted Tube", null, pos).insert();

x = new Chimney("Cubed Chimney", null, pos).insert();

