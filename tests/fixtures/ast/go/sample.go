package fixture

import "fmt"

type Store struct { Value string }

func (store *Store) Load(value string) (string, error) {
    fmt.Println(value)
    return value, nil
}

func Plain() {}
