(ns lesson01.hello-test
  (:require [clojure.test :refer [deftest is]]
            [lesson01.hello :as h]))

(deftest add-test
  (is (= 5 (h/add 2 3))))
