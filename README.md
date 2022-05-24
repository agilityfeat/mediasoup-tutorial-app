# Mediasoup Tutorial App

A text and audio conference app to jump start mediasoup development

## Dependencies

* [Mediasoup v3 requirements](https://mediasoup.org/documentation/v3/mediasoup/installation/#requirements)
* Node.js >= v8.6
* [Browserify](http://browserify.org/)


## Run

The server app runs on any supported platform by Mediasoup. The client app runs on a single browser tab.
```
# create and modify the configuration
# make sure you set the proper IP for mediasoup.webRtcTransport.listenIps
cp config.example.js config.js
nano config.js

# install dependencies and build mediasoup
npm install

# create the client bundle and start the server app
npm start
```

Application will be running in https://localhost:3000

## Run with docker

```
docker build . -t <your username>/mediasoup-demo
```

Run the image you previously built:

```
docker run -p 3000:3000 -p 10000-10100:10000-10100/udp -d <your username>/mediasoup-demo
```
