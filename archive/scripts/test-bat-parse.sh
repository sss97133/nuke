#!/bin/bash
curl -X POST 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/parse-bat-to-validations' \
  -H 'Content-Type: application/json' \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZ2cmVybnN0cGx6amFhbSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzI3MzA5NDA5LCJleHAiOjIwNDI4ODU0MDl9.sS_1A-aWjBHWTH8tFdHTWr0fhGjFhZrQ2xCdQF1uMcI" \
  -d '{
    "batUrl": "https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-105/",
    "vehicleId": "655f224f-d8ae-4fc6-a3ec-4ab8db234fdf",
    "userId": "0b9f107a-d124-49de-9ded-94698f63c1c4"
  }'
