var express  = require('express');
var https = require('https');
var bodyParser  = require('body-parser');
var passport = require('passport');
var session = require('express-session');
var multipart = require('connect-multiparty')({uploadDir: __dirname+'/tmp'});
var config = require(__dirname+'/config.json');

var path = require('path');
var fs = require('fs');

var GOOGLE_CONSUMER_KEY = config.apiKey;
var GOOGLE_CONSUMER_SECRET = config.apiSecret;
var PATHFINDER_ID = config.pathfinderId;
var DOMAIN_NAME = config.domainName;
var PORT = config.port;
var SERVER_URL = "http://"+DOMAIN_NAME;

var app = express();

function geocode(address,done,error){
	console.log("geocoding address: "+address);
	https.request({
			host:'maps.googleapis.com',
			path:'/maps/api/geocode/json?address='+encodeURIComponent(address),
			method:'GET'
		}, function(response){
			var str = '';
			response.on('data',function(dat){
				str += dat;
			});
			response.on('end',function(){
				var data = JSON.parse(str);
				console.log(data);
				var pos = data.results[0].geometry.location
				done(pos);
			});
			response.on('error',function(err){
				error(err);
			});
		}
	).end();
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

function User(profile, idToken){
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
	this.idToken = idToken;
	this.chimneys = {};
}

User.prototype = new Record(database.users);

function homeView(session, tab, swap){
	console.log(session);
	var obj;
	if(session && session.passport && session.passport.user){
		obj = database.users[session.passport.user].homeView(tab, swap);
	} else {
		obj = {
			chimneys:database.chimneys,
			theme:'slate',
			tab:tab || 'search',
			pathfinderId: PATHFINDER_ID,
			idToken: session.idToken
		};
	}
	if(swap && swap.theirs){
		obj.swap = {
			mine: database.chimneys[swap.mine],
			theirs: database.chimneys[swap.theirs]
		};
		var mine = database.chimneys[swap.mine];
		var theirs = database.chimneys[swap.theirs];
		if(mine){
			mine.remove();
		}
		if(theirs){
			theirs.remove();
		}
	}
	return obj;
}

User.prototype.homeView = function(tab){
	return {
		myChimneys:database.users[this.id].chimneys,
		chimneys:database.chimneys,
		pathfinderId: PATHFINDER_ID,
		idToken: this.idToken,
		theme:'slate',
		tab:(tab || 'search')
	};
};

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
	delete database.sharedChimneys[this.id];
	if(this.user){
		delete this.user.chimneys[this.id];
	}
	return Record.prototype.remove.call(this);
};

Chimney.prototype.insertCascade = function(){
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
		image:    this.imageUrl()
	};
	if(this.user){
		obj.userId = this.user.id;
	}
	return JSON.stringify(obj);
};

Chimney.prototype.imageUrl = function(){
	return SERVER_URL+'/images/'+this.id+'.png';
};

Chimney.prototype.imagePath = function(){
	return __dirname+'/images/'+this.id+'.png';
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

function getId(req,res,next){
	if(!req.session.idToken){
		if(req.query.id_token){
			req.session.idToken = req.query.id_token;
			next();
			return;
		}
		res.redirect(
			'https://auth.thepathfinder.xyz/auth/google?' +
			'application='+encodeURIComponent(PATHFINDER_ID) + '&' +
			'return_url='+encodeURIComponent(req.protocol+'://'+req.hostname+':'+PORT+req.path)
		);
		return
	}
	next();
}

app.use(bodyParser.json({limit:'50mb'}));
app.use(bodyParser.urlencoded());

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

app.get('/home', getId, function(req,res){
	var tab = req.param('tab') || 'search';
	var swap = req.param('swap');
	var mine = req.param('mine');
	res.render('home',homeView(req.session, tab,{
		mine: mine, theirs: swap
	}));
});

app.post('/swap', getId, function(req,res){
	var mine = req.param('mine');
	var theirs = req.param('theirs');
	res.render('home',homeView(req.session,'swap',{mine:mine,theirs:theirs}));
});

app.post('/chimney', getId, multipart, function (req, res) {
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
	var tab = req.param('tab');
	var swap = req.param('swap');
	function makeChimney(position){
		console.log("Sample application trying to make chimney in makeChimney at position: "+position);
		var chimney = new Chimney(name, user, position);
		chimney.insert();
		var targetPath = path.resolve(chimney.imagePath());
		console.log(req.files);
		if(img){
			console.log("WRITING IMAGE");
			fs.writeFile(targetPath, img.file_data, 'base64', function(err){
				if(err) {
					console.log(err);
					res.setHeader('Content-Type', 'text/plain');
					res.status(400).send('bad image');
				} else if(tab){
					res.redirect('/home?tab='+tab+'&swap='+swap+'&mine='+chimney.id);
					return;
				} else
					res.status(201).send();
			});
		} else if (req.files.image) {
			var tempPath = req.files.image.path;
			fs.rename(tempPath, targetPath, function(err) {
				if (err) {
					console.log(err);
					res.setHeader('Content-Type', 'text/plain');
					res.status(400).send('bad image');
					fs.unlink(tempPath)
				} else if(tab){
					res.redirect('/home?tab='+tab+'&swap='+swap+'&mine='+chimney.id);
					return;
				} else
					res.status(201).send()
			});
		} else {
			res.setHeader('Content-Type', 'text/plain');
			res.status(400).send('no images');
		}
	}
	if(latitude){
		if(longitude){
			makeChimney({lat: latitude, lng: longitude});
		} else {
			res.setHeader('Content-Type', 'text/plain');
			req.status(400).send('no longitude provided');
			return;
		}
	} else if(position){
		makeChimney(position);
	} else if(address){
		geocode(address, makeChimney, function(err){
			console.error(err);
			res.setHeader('Content-Type', 'text/plain');
			res.status(400).send("invalid address: "+address);	
		});
	} else {
		res.setHeader('Content-Type', 'text/plain');
		res.status(400).send("Address or Position Required");
	}
});

app.get('/chimney', function (req, res){
	console.log("GET WAS CALLED");
	var id = req.param('id');
	var chimney = database.chimneys[id];
	if(!chimney){
		res.setHeader('Content-Type', 'text/plain');
		res.status(404).send("Chimney Not Found");
		return;
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

x = new Chimney("Silver Stack", user, pos).insert();

x = new Chimney("Cinder Smokeshaft", null, pos).insert();

x = new Chimney("Amber Pillar", null, pos).insert();

x = new Chimney("Bricked Square Shaft", null, pos).insert();

x = new Chimney("Victorian Ventilator", null, pos).insert();

x = new Chimney("Chimney Rock", null, pos).insert();

x = new Chimney("Twisted Tube", null, pos).insert();

x = new Chimney("Cubed Chimney", null, pos).insert();

