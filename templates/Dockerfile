FROM node:8.9.4-alpine as builder
COPY ./ /app
WORKDIR /app

RUN apk add --no-cache \
	--virtual .build-deps \
	g++ \
	git \
	curl \
	make \
	python

RUN npm install

# Build container image
FROM node:8.9.4-alpine
COPY --from=builder /app /app
WORKDIR /app

# Create user
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app
USER app
EXPOSE 3000
ENTRYPOINT ["node", "./bin/www"]
