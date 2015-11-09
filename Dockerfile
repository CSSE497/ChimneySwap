FROM centos:centos6
RUN yum install -y epel-release
RUN yum install -y nodejs npm
COPY . /app
RUN cd /app; npm install
EXPOSE 3000
CMD ["node", "/app/chimney-swap-server.js"]
