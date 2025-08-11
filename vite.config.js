import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './'  // ¡MUY IMPORTANTE para GitHub Pages!
})
