(ns lesson01.hello
  "Part 1's lesson. Replace with the real thing; keep the shape: small fns, a -main demo, and
  EXERCISE markers around the bodies a reader should write themselves.")

(defn add
  "Adds two numbers."
  [a b]
  ;; EXERCISE(add): Return the sum of a and b.
  (+ a b)
  ;; END EXERCISE
  )

(defn -main [& _]
  (println "2 + 3 =" (add 2 3)))
