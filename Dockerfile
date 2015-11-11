FROM centos:centos6
RUN yum install -y epel-release
RUN yum install -y nodejs npm
COPY . /app
CMD "sh" "-c" "echo nameserver 8.8.8.8 > /etc/resolv.conf"
RUN cd /app; npm install
EXPOSE 3000
CMD ["node", "/app/chimney-swap-server.js"]
