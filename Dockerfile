FROM node:16 AS stage-one

# Install DEB dependencies and others.
RUN \
	set -x \
	&& apt-get update \
	&& apt-get install -y net-tools build-essential python3 python3-pip valgrind

WORKDIR /service

COPY package.json .
RUN npm install && npm install -g browserify
COPY server.js .
COPY config.js .
COPY client.js .
COPY lib lib
COPY public public
COPY certs certs

EXPOSE 3000
EXPOSE 10000-10100/udp

CMD ["npm", "start"]