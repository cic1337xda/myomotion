FROM nginx:alpine

# Remove default static files
RUN rm -rf /usr/share/nginx/html/*

# Copy Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy frontend source files
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
